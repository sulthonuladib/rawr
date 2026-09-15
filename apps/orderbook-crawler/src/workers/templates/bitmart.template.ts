import type { TemplateCoin } from "./template-coin.js";

export const bitmartOrderbookTemplate = (coins: ReadonlyArray<TemplateCoin>, instanceId: number): string => `
const { WebsocketClient } = require("bitmart-api");
const amqp = require("amqplib");
const { EXIT_EVENTS } = require("../../constants/exit-event.constant");

/** @type {Map<string, number>} */
const SymbolStore = new Map();
/** @type {Map<string, Map<string, number>} */
const LastSentStore = new Map();
const MARKET = "bitmart-" + ${instanceId};

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
      Buffer.from(JSON.stringify({ market: MARKET, status: "connected" })),
    );
  });

  socketClient.on("update", (message) => {
    if ("data" in message) {
      const [{ symbol, asks, bids }] = message.data;
      const currentTime = Date.now();
      const lastSentTime = LastSentStore.get(symbol);
      const lastSentMS = currentTime - lastSentTime;
      if (lastSentMS < 1000) {
        return;
      }
      LastSentStore.set(symbol, currentTime);

      const cmcId = SymbolStore.get(symbol);
      amqpChannel.sendToQueue(
        "bitmart",
        Buffer.from(JSON.stringify({ cmcId, asks, bids })),
      );
      return;
    }
    // const symbol = message?.event.split(":").pop().slice(0, -5);
    // amqpChannel.sendToQueue(
    //   "crawler-logs",
    //   Buffer.from(JSON.stringify({ market: "BITMART", status: 'invalid-symbol', symbol })),
    // );
    return;
  });

  socketClient.on("reconnect", () => {
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(
        JSON.stringify({ market: MARKET, status: "reconnecting" }),
      ),
    );
  });

  socketClient.on("reconnected", () => {
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(
        JSON.stringify({ market: MARKET, status: "connected" }),
      ),
    );
  });

  socketClient.on("close", (code, reason) => {
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(JSON.stringify({ market: MARKET, status: "close" })),
    );
    console.log("close", code, reason);
  });

  socketClient.on("exception", async (error) => {
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(JSON.stringify({ market: MARKET, status: "error" })),
    );
    console.error("exception", error);
  });

  try {
    console.log(metadata.length);
    for (const [symbol, cmcId] of metadata) {
      SymbolStore.set(symbol, cmcId);
      LastSentStore.set(symbol, Date.now());
      socketClient.subscribe(["spot/depth50:" + symbol], "spot");
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
        Buffer.from(JSON.stringify({ market: MARKET, status: "stopped" })),
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
