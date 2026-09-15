module.exports = (coins, instanceId) => `
const { WebsocketClient } = require("gateio-api");
const amqp = require("amqplib");
const { EXIT_EVENTS } = require("../../constants/exit-event.constant");

/** @type {Map<string, number>} */
const SymbolStore = new Map();
/** @type {Map<string, Map<string, number>} */
const LastSentStore = new Map();

const MARKET = "gateio";
const LOG_ID = ${instanceId};
const MARKET_LOG_ID = MARKET + "-" + LOG_ID;

const socketClient = new WebsocketClient();

/**
 * @param {[string, number][]} metadata
 * @param {import("amqplib").Channel} amqpChannel
 */
function stream(metadata, amqpChannel) {
  socketClient.on("open", (data) => {
    console.log("open", data.wsKey);
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(
        JSON.stringify({ market: MARKET_LOG_ID, status: "connected" }),
      ),
    );
  });

  socketClient.on("update", (message) => {
    if ("event" in message) {
      const { event, result } = message;
      if (event === "update") {
        const currentTime = Date.now();
        const lastSentTime = LastSentStore.get(result.s);
        const lastSentMS = currentTime - lastSentTime;
        if (lastSentMS < 1000) {
          return;
        }

        LastSentStore.set(result.s, currentTime);

        const { asks, bids } = result;
        const cmcId = SymbolStore.get(result.s);

        amqpChannel.sendToQueue(
          MARKET,
          Buffer.from(JSON.stringify({ cmcId, asks, bids })),
        );
        return;
      }
    }

    return;
  });

  socketClient.on("close", (code, reason) => {
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(JSON.stringify({ market: MARKET_LOG_ID, status: "close" })),
    );
    console.log("close", code, reason);
  });

  socketClient.on("exception", (error) => {
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(JSON.stringify({ market: MARKET_LOG_ID, status: "close" })),
    );
    console.error("exception", error);
  });

  socketClient.on("reconnect", () => {
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(
        JSON.stringify({ market: MARKET_LOG_ID, status: "reconnecting" }),
      ),
    );
  });

  socketClient.on("reconnected", () => {
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(
        JSON.stringify({ market: MARKET_LOG_ID, status: "connected" }),
      ),
    );
  });

  try {
    console.log(metadata.length);
    for (const [symbol, cmcId] of metadata) {
      const subscription = symbol;
      SymbolStore.set(subscription, cmcId);
      LastSentStore.set(subscription, Date.now());
      socketClient.subscribe(
        [{ topic: "spot.order_book", payload: [symbol, "50", "1000ms"] }],
        "spotV4",
      );
    }
  } catch (error) {
    console.error("error", error);
  }
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
    return [symbol.toUpperCase() + "_USDT", Number(cmcId)];
  });
}

async function start() {
  // TODO: in the future we should just use cli args as params
  // instead of building files
  // const symbols = parseArgs(process.argv[2]);

	const args = ${JSON.stringify(coins)}
  .map((coin) => coin.symbol + ":" + coin.cmcId);
  const symbols = parseArgs(args.join(","));
  const connection = await amqp.connect(
    process.env.AMQP_URL || "amqp://localhost",
  );
  const amqpChannel = await connection.createChannel();

  stream(symbols, amqpChannel);
  EXIT_EVENTS.forEach((event) => {
    process.on(event, () => {
      amqpChannel.sendToQueue(
        "crawler-logs",
        Buffer.from(
          JSON.stringify({ market: MARKET_LOG_ID, status: "stopped" }),
        ),
      );
      setTimeout(() => {
        console.log("exited");
        process.exit();
      }, 2000);
    });
  });
}

start();
`;