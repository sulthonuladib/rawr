import type { TemplateCoin } from "./template-coin.js";

const javascript = String.raw;

export const bittimeOrderbookTemplate = (symbols: ReadonlyArray<TemplateCoin>, instanceId: number): string => javascript`
const WebSocket = require("ws");
const pako = require("pako");
const amqp = require("amqplib");

const WS_URL = "wss://ws.bittime.com/market/ws";

const SymbolStore = new Map();

/**
 * @param {Array<{symbol: string, cmcId: number}>} coins
 */
async function stream(coins) {
  const connection = await amqp.connect(process.env.AMQP_URL || "amqp://localhost");
  const amqpChannel = await connection.createChannel();
  await amqpChannel.assertQueue("bittime", { durable: false, maxLength: 500 });
  console.log("connected to rabbitmq");

  const loggingChannel = await connection.createChannel();
  await loggingChannel.assertQueue("crawler-logs", { durable: false });

  const socket = new WebSocket(WS_URL);

  socket.on("open", async () => {
    console.log("Connected to BitTime");
    loggingChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(JSON.stringify({ market: "bittime-${instanceId}", status: "connected" })),
    );
    for (const coin of coins) {
      const channel = "market_" + coin.symbol + "idr_depth_step0";
      SymbolStore.set(channel, coin.cmcId);
      socket.send(
        JSON.stringify({
          event: "sub",
          params: {
            cb_id: coin.symbol + "idr",
            channel,
          },
        }),
      );
    }
    loggingChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(JSON.stringify({ market: "bittime-${instanceId}", status: "subscribed" })),
    );
  });

  socket.on("message", (event) => {
    const message = JSON.parse(pako.inflate(event, { to: "string" }));

    if ("tick" in message) {
      const cmcId = SymbolStore.get(message.channel);
      // const symbol = message.channel.split("_")[1].replace("idr", "");
      const [sellPrice, sellAmount] = search(
        message.tick.buys.map(parseRawOrder),
      );
      const [buyPrice, buyAmount] = search(
        message.tick.asks.map(parseRawOrder),
      );
      amqpChannel.sendToQueue(
        "bittime",
        Buffer.from(
          JSON.stringify({
            cmcId,
            buyPrice,
            buyAmount,
            sellPrice,
            sellAmount,
          }),
        ),
      );
      return;
    }

    if ("ping" in message) {
      const date = new Date();
      // console.log(
      //   "Bittime pinged us, sending pong...",
      //   date.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
      // );
      socket.send(JSON.stringify({ pong: date }));
      loggingChannel.sendToQueue(
        "crawler-logs",
        Buffer.from(JSON.stringify({ market: "bittime-${instanceId}", status: "pong" })),
      );
      return;
    }

    if ("status" in message) {
      // console.log("Subscribed", message.cb_id);
      return;
    }
  });

  socket.on("close", (code, reason) => {
    console.log(
      "Connection closed",
      code,
      pako.inflate(reason, { to: "string" }),
    );
    loggingChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(JSON.stringify({ market: "bittime-${instanceId}", status: "closed" })),
    );
    setTimeout(() => {
      console.log("Reconnecting");
      loggingChannel.sendToQueue(
        "crawler-logs",
        Buffer.from(
          JSON.stringify({ market: "bittime-${instanceId}", status: "reconnecting" }),
        ),
      );
      main();
    }, 2000);
  });

  socket.on("error", (err) => {
    console.error(err);
    loggingChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(JSON.stringify({ market: "bittime-${instanceId}", status: "error" })),
    );
    socket.close();
  });

  ["exit", "SIGINT", "SIGUSR1", "SIGUSR2", "SIGTERM"].forEach((eventType) => {
    process.on(eventType, () => {
      loggingChannel.sendToQueue(
        "crawler-logs",
        Buffer.from(JSON.stringify({ market: "bittime-${instanceId}", status: "stopped" })),
      );
      setTimeout(() => {
        process.exit();
      }, 2000);
    });
  });
  process.on("uncaughtException", (err) => {
    console.error(err);
    loggingChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(
        JSON.stringify({ market: "bittime-${instanceId}", status: "uncaughtException" }),
      ),
    );
    socket.close();
  });
}

function parseRawOrder(order) {
  return [
    order[4], // price
    order[5], // summed amount
  ];
}

function search(order, requiredAmount = 10_000_000) {
  const result = order.find(([, amount]) => amount >= requiredAmount);
  if (!result) {
    return [0, 0];
  }

  return result;
}

async function main() {
  const symbols = ${JSON.stringify(symbols)};

  await stream(symbols);
}

main();
`;