module.exports = (coins, instanceId) => `
const { WebsocketClient } = require("kucoin-api");
const amqp = require("amqplib");
const { EXIT_EVENTS } = require("../../constants/exit-event.constant");
const { arrayToMultiDimension } = require("../../utils/array-splitter");
const { execSync } = require("node:child_process");

/** @type {Map<string, number>} */
const SymbolStore = new Map();
/** @type {Map<string, Map<string, number>} */
const LastSentStore = new Map();

const MARKET = "kucoin";
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
    if ("data" in message) {
      const currentTime = Date.now();
      const lastSentTime = LastSentStore.get(message.topic);
      const lastSentMS = currentTime - lastSentTime;
      if (lastSentMS < 1000) {
        return;
      }

      LastSentStore.set(message.topic, currentTime);

      const { asks, bids } = message.data;
      const cmcId = SymbolStore.get(message.topic);

      amqpChannel.sendToQueue(
        MARKET,
        Buffer.from(JSON.stringify({ cmcId, asks, bids })),
      );
      return;
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

  socketClient.on("exception", (error) => {
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(JSON.stringify({ market: MARKET_LOG_ID, status: "error" })),
    );
    console.error("exception", error);
  });

  try {
    console.log(metadata.length);
    for (const [index, meta] of arrayToMultiDimension(metadata, 10).entries()) {
      const subscriptions = meta.map(([symbol, cmcId]) => {
        const subscription = "/spotMarket/level2Depth50:" + symbol;
        SymbolStore.set(subscription, cmcId);
        LastSentStore.set(subscription, Date.now());
        return subscription;
      })

			socketClient.subscribe(subscriptions, "spotPublicV1");
			console.log("subscribed at collection", index);

			console.log("sleeping 1s before sending subscriptions collection number", index);
			execSync("sleep 1")
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
    return [symbol.toUpperCase() + "-USDT", Number(cmcId)];
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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