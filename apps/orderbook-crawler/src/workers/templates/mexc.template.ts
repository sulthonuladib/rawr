import type { TemplateCoin } from "./template-coin.js";

export const mexcOrderbookTemplate = (symbols: ReadonlyArray<TemplateCoin>, index: number): string => `
const WebSocket = require('ws');
const amqp = require('amqplib');
const { PushDataV3ApiWrapper } = require("../../gen/js/PushDataV3ApiWrapper")

const SEND_INTERVAL = 1000; // Minimum interval between sends in milliseconds
const SymbolStore = new Map();
const LastSendTime = new Map();

async function main() {
  const connection = await amqp.connect(process.env.AMQP_URL || 'amqp://localhost');
  const channel = await connection.createChannel();
  await channel.assertQueue('mexc', { durable: false, maxLength: 1000 });
  console.log('connected to rabbitmq');

  const loggingChannel = await connection.createChannel();
  await loggingChannel.assertQueue('crawler-logs', { durable: false });

  const socket = new WebSocket('wss://wbs-api.mexc.com/ws');
  const coins = ${JSON.stringify(symbols)};

  socket.on('open', () => {
    console.log('open');
    loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'mexc-${index}', status: 'connected' })));
    for (const coin of coins) {
      const param =
        "spot@public.limit.depth.v3.api.pb@" +
        coin.symbol.toUpperCase() +
        "USDT@20";
      SymbolStore.set(coin.symbol.toUpperCase() + "USDT", coin.cmcId);
      LastSendTime.set(coin.symbol.toUpperCase() + "USDT", Date.now());
      socket.send(JSON.stringify({
        "method": "SUBSCRIPTION",
        "params": [param],
      }));
    }
    loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'mexc-${index}', status: 'subscribed' })));
  })

  socket.on('message', (rawMessage) => {
    // ignore if the message is json
    try {
      const jsonMessage = JSON.parse(rawMessage.toString());
      if (jsonMessage) {
        if (jsonMessage?.msg === "PONG") {
          console.log("DEBUG: got pong from mexc");
          return;
        }
				if (jsonMessage?.msg.includes("public.limit.depth.v3.api.pb")) {
					console.log("DEBUG: sub ok " + jsonMessage.msg)
				}
        return;
      }
    } catch (error) {}

    // parse as protobuf
    try {
      const message = PushDataV3ApiWrapper.decode(rawMessage);
      const lastSendTime = LastSendTime.get(message.symbol);
      const currentTime = Date.now();
      const lastSendMS = currentTime - lastSendTime;
      if (lastSendMS < SEND_INTERVAL) {
        return;
      }

      LastSendTime.set(message.symbol, currentTime);
      const cmcId = SymbolStore.get(message.symbol);
      const asks = message.publicLimitDepths.asks.map(
        ({ price, quantity }) => [price, quantity],
      );
      const bids = message.publicLimitDepths.bids.map(
        ({ price, quantity }) => [price, quantity],
      );
      const data = { cmcId, asks, bids };
      channel.sendToQueue("mexc", Buffer.from(JSON.stringify(data)));
    } catch (error) {
      console.log("error parsing as it's not a json", error);
    }
  });
  const pingInterval = setInterval(() => {
    socket.send(JSON.stringify({
      "method": "PING",
    }));
    loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'mexc-${index}', status: 'ping' })));
    console.log('PING');
  }, 5000);

  socket.on('close', async () => {
    clearInterval(pingInterval);
    console.log('closed');
    loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'mexc-${index}', status: 'closed' })));

    setTimeout(async () => {
      await main();
      loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'mexc-${index}', status: 'reconnecting' })));
    }, 2000);
  });

  socket.on('error', () => {
    loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'mexc-${index}', status: 'error' })));
    socket.close();
  })
  socket.on('ping', () => {
    loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'mexc-${index}', status: 'pong' })));
    socket.pong();
  });

  const exitSignals =['exit', 'SIGINT', 'SIGUSR1', 'SIGUSR2', 'uncaughtException', 'SIGTERM'];
  exitSignals.forEach((eventType) => {
    process.on(eventType, () => {
      loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'mexc-${index}', status: 'stopped' })));
      setTimeout(() => {
        process.exit();
      }, 2000);
    });
  });
}

main();
`;