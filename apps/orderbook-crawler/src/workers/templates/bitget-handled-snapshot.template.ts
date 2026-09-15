import type { TemplateCoin } from "./template-coin.js";

export const bitgetHandledSnapshotTemplate = (coins: ReadonlyArray<TemplateCoin>, instanceId: number): string => `
const { WebsocketClientV2 } = require("bitget-api");
const amqp = require("amqplib");
const { EXIT_EVENTS } = require("../../constants/exit-event.constant");

/** @type {Map<string, number>} */
const SymbolStore = new Map();

/** @type {Map<string, number>} */
const LastSentStore = new Map();

/**
 * symbol => {
 *   asks: Map<string, string>,
 *   bids: Map<string, string>,
 *   seq: number
 * }
 *
 * @type {Map<string, {
 *   asks: Map<string, string>,
 *   bids: Map<string, string>,
 *   seq: number
 * }>}
 */
const OrderBookStore = new Map();

const MARKET = "bitget";
const LOG_ID = ${instanceId};
const MARKET_LOG_ID = MARKET + "-" + LOG_ID;

const socketClient = new WebsocketClientV2();

function applyLevels(levels, updates) {
  for (const [price, size] of updates) {
    if (size === "0") {
      levels.delete(price);
    } else {
      levels.set(price, size);
    }
  }
}

function publishBook(symbol, amqpChannel) {
  const book = OrderBookStore.get(symbol);

  if (!book) {
    return;
  }

  const cmcId = SymbolStore.get(symbol);

  amqpChannel.sendToQueue(
    MARKET,
    Buffer.from(
      JSON.stringify({
        cmcId,
        asks: [...book.asks.entries()],
        bids: [...book.bids.entries()],
      }),
    ),
  );
}

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
        JSON.stringify({
          market: MARKET_LOG_ID,
          status: "connected",
        }),
      ),
    );
  });

  socketClient.on("update", (message) => {
    if (!("data" in message)) {
      return;
    }

    const symbol = message.arg.instId;
    const [payload] = message.data;

    // Initial orderbook snapshot
    if (message.action === "snapshot") {
      OrderBookStore.set(symbol, {
        asks: new Map(payload.asks),
        bids: new Map(payload.bids),
        seq: payload.seq,
      });
    }

    // Incremental updates
    else if (message.action === "update") {
      const book = OrderBookStore.get(symbol);

      if (!book) {
        console.warn(
          \`[\${symbol}] update received before snapshot\`,
        );
        return;
      }

      if (book.seq !== payload.pseq) {
        console.error(
          \`[\${symbol}] sequence mismatch local=\${book.seq} pseq=\${payload.pseq}\`,
        );

        // local book is corrupted, wait for fresh snapshot
        OrderBookStore.delete(symbol);

        socketClient.unsubscribeTopic(
          "SPOT",
          "books",
          symbol,
        );

        socketClient.subscribeTopic(
          "SPOT",
          "books",
          symbol,
        );

        return;
      }

      applyLevels(book.asks, payload.asks);
      applyLevels(book.bids, payload.bids);

      book.seq = payload.seq;
    } else {
      return;
    }

    // throttle publishing only
    const now = Date.now();
    const lastSent = LastSentStore.get(symbol) || 0;

    if (now - lastSent < 1000) {
      return;
    }

    LastSentStore.set(symbol, now);

    publishBook(symbol, amqpChannel);
  });

  socketClient.on("close", (code, reason) => {
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(
        JSON.stringify({
          market: MARKET_LOG_ID,
          status: "close",
        }),
      ),
    );

    console.log("close", code, reason);
  });

  socketClient.on("exception", (error) => {
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(
        JSON.stringify({
          market: MARKET_LOG_ID,
          status: "close",
        }),
      ),
    );

    console.error("exception", error);
  });

  socketClient.on("reconnect", () => {
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(
        JSON.stringify({
          market: MARKET_LOG_ID,
          status: "reconnecting",
        }),
      ),
    );
  });

  socketClient.on("reconnected", () => {
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(
        JSON.stringify({
          market: MARKET_LOG_ID,
          status: "connected",
        }),
      ),
    );
  });

  try {
    console.log(metadata.length);

    for (const [symbol, cmcId] of metadata) {
      SymbolStore.set(symbol, cmcId);
      LastSentStore.set(symbol, 0);

      socketClient.subscribeTopic(
        "SPOT",
        "books",
        symbol,
      );
    }
  } catch (error) {
    console.error("error", error);
  }
}

/**
 * @param {string} args
 * @returns {[number, string][]}
 */
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

    return [
      symbol.toUpperCase() + "USDT",
      Number(cmcId),
    ];
  });
}

async function start() {
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
          JSON.stringify({
            market: MARKET_LOG_ID,
            status: "stopped",
          }),
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
