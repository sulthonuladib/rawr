module.exports = (symbols, instanceId) => `
  const amqp = require("amqplib");
  const { EXIT_EVENTS } = require("../../constants/exit-event.constant");

  const {
    DefaultLogger,
    isWsOrderbookEventV5,
    WebsocketClient,
    WSOrderbookEventV5,
  } = require("bybit-api");
  const {
    OrderBookLevel,
    OrderBookLevelState,
    OrderBooksStore,
  } = require("orderbooks");

  /** @type {Map<string, number>} */
  const SymbolStore = new Map();
  /** @type {Map<string, Map<string, number>} */
  const LastSentStore = new Map();
  const MARKET = "bybit";
  const INSTANCE_ID = ${instanceId};
  const MARKET_LOG_ID = MARKET + "-" + INSTANCE_ID;

  const OrderBooks = new OrderBooksStore({
    traceLog: false,
    checkTimestamps: false,
  });
  DefaultLogger.trace = () => {};
  DefaultLogger.info = () => {};

  /**
   * @param {[string, number][]} metadata
   * @param {import("amqplib").Channel} amqpChannel
   */
  function stream(metadata, amqpChannel) {
    const ws = new WebsocketClient({
      market: "v5",
    });
    for (const [symbol, cmcId] of metadata) {
      SymbolStore.set(symbol, cmcId);
      LastSentStore.set(symbol, cmcId);

      ws.subscribeV5([symbol], "spot");
    }
    ws.on("open", (data) => {
      console.log("open", data.wsKey);

      amqpChannel.sendToQueue(
        "crawler-logs",
        Buffer.from(
          JSON.stringify({ market: MARKET_LOG_ID, status: "connected" }),
        ),
      );
    });

    ws.on("update", (message) => {
      if (isWsOrderbookEventV5(message)) {
        // console.log(message.topic, message.type, message.data)
        const update = handleOrderbookUpdate(message);
        if (!update) return;

        const currentTime = Date.now();
        const lastSentTime = LastSentStore.get(update.topic);
        const lastSentMS = currentTime - lastSentTime;
        if (lastSentMS < 1000) {
          return;
        }
        LastSentStore.set(update.topic, currentTime);

        const bookState = OrderBooks.getBook(update.symbol).getBookState();
        const { asks, bids } = mapToMQ(bookState);
        const cmcId = SymbolStore.get(update.topic);

        amqpChannel.sendToQueue(
          MARKET,
          Buffer.from(JSON.stringify({ cmcId, asks, bids })),
        );
        // console.log(data);
        return;
      }
    });

    ws.on("exception", (message) => {
      amqpChannel.sendToQueue(
        "crawler-logs",
        Buffer.from(JSON.stringify({ market: MARKET_LOG_ID, status: "close" })),
      );
      console.error("exception", message);
    });

    ws.on("close", (code, reason) => {
      amqpChannel.sendToQueue(
        "crawler-logs",
        Buffer.from(JSON.stringify({ market: MARKET_LOG_ID, status: "close" })),
      );
      console.log("close", code, reason);
    });
    ws.on("reconnect", () => {
      amqpChannel.sendToQueue(
        "crawler-logs",
        Buffer.from(
          JSON.stringify({ market: MARKET_LOG_ID, status: "reconnecting" }),
        ),
      );
    });
    ws.on("reconnected", () => {
      amqpChannel.sendToQueue(
        "crawler-logs",
        Buffer.from(
          JSON.stringify({ market: MARKET_LOG_ID, status: "connected" }),
        ),
      );
    });
  }

  // parse orderbook messages, detect snapshot vs delta, and format properties using OrderBookLevel
  /**
   * @param {WSOrderbookEventV5} message
   */
  function handleOrderbookUpdate(message) {
    const { topic, type, data, cts } = message;
    const [topicKey, _depth, symbol] = topic.split(".");

    const bidsArray = data.b.map(([price, amount]) => {
      return OrderBookLevel(symbol, +price, "Buy", +amount);
    });

    const asksArray = data.a.map(([price, amount]) => {
      return OrderBookLevel(symbol, +price, "Sell", +amount);
    });

    const allBidsAndAsks = [...bidsArray, ...asksArray];

    if (type === "snapshot") {
      OrderBooks.handleSnapshot(symbol, allBidsAndAsks, cts);

      return { topic, symbol };
    }

    if (type === "delta") {
      /** @type {OrderBookLevelState} */
      const upsertLevels = [];
      /** @type {OrderBookLevelState} */
      const deleteLevels = [];

      allBidsAndAsks.forEach((level) => {
        const [_symbol, _price, _side, qty] = level;

        if (qty === 0) {
          deleteLevels.push(level);
        } else {
          upsertLevels.push(level);
        }
      });

      OrderBooks.handleDelta(symbol, deleteLevels, upsertLevels, [], cts);

      return { topic, symbol };
    }

    console.error("unhandled orderbook update type: ", type);
  }

  /**
   *
   * @param {OrderBookLevelState[]} data
   */
  function mapToMQ(data) {
    const bids = data
      .filter((x) => x[2] === "Buy")
      .map((x) => {
        return [x[1], x[3]];
      });
    // .toSorted((a, b) => {
    //   return a[0] - b[0];
    // });
    const asks = data
      .filter((x) => x[2] === "Sell")
      .map((x) => {
        return [x[1], x[3]];
      });
    // .toSorted((a, b) => {
    //   return a[0] - b[0];
    // });

    return { asks, bids };
  }

  /**
   * @param {string} args
   * @returns {[number, string][]}
   * */
  function parseArgs(args) {
    if (!args) {
      console.error("No symbols provided");
      process.exit(1);
    }

    return args.split(",").map((meta) => {
      const [symbol, cmcId] = meta.split(":");
      if (isNaN(Number(cmcId)) || !symbol) {
        console.error("Invalid symbol format");
        process.exit(1);
      }
      return ["orderbook.50." + symbol.toUpperCase() + "USDT", Number(cmcId)];
    });
  }

  async function main() {
    const connection = await amqp.connect(
      process.env.AMQP_URL || "amqp://localhost",
    );
    const amqpChannel = await connection.createChannel();
    console.log("connected to rabbitmq");

    const args =  ${JSON.stringify(symbols)}
      .map((coin) => coin.symbol + ":" + coin.cmcId);
    const symbols = parseArgs(args.join(","));

    stream(symbols, amqpChannel);
    EXIT_EVENTS.forEach((eventType) => {
      process.on(eventType, () => {
        amqpChannel.sendToQueue(
          "crawler-logs",
          Buffer.from(
            JSON.stringify({ market: MARKET_LOG_ID, status: "stopped" }),
          ),
        );
        setTimeout(() => {
          process.exit();
        }, 2000);
      });
    });
  }

  main();
`;
