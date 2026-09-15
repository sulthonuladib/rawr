import type { TemplateCoin } from "./template-coin.js";

export const okxOrderbookTemplate = (symbols: ReadonlyArray<TemplateCoin>, index: number): string => `
const WebSocket = require('ws');
const amqp = require('amqplib');

const SEND_INTERVAL = 1000; // Minimum interval between sends in milliseconds
const SymbolStore = new Map();
const LastSendTime = new Map();

async function main() {
  const connection = await amqp.connect(process.env.AMQP_URL || 'amqp://localhost');
  const channel = await connection.createChannel();
  await channel.assertQueue('okx', { durable: false, maxLength: 1000 });
  console.log('connected to rabbitmq');

  const loggingChannel = await connection.createChannel();
  await loggingChannel.assertQueue('crawler-logs', { durable: false });

  const socket = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
  const coins = ${JSON.stringify(symbols)};

  let orderBooks = coins.reduce((acc, coin) => {
    acc[coin] = { bids: [], asks: [] };
    return acc;
  }, {});

  socket.on('open', () => {
    console.log('open');
    loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'okx-${index}', status: 'connected' })));
    coins.forEach(coin => {
      const subscribeMessage = {
        op: 'subscribe',
        args: [
          {
            channel: 'books',
            instId: coin.symbol.toUpperCase() + '-USDT'
          }
        ]
      };
      SymbolStore.set(coin.symbol.toUpperCase() + "-USDT", coin.cmcId);
      LastSendTime.set(coin.symbol.toUpperCase() + -"USDT", Date.now());
      socket.send(JSON.stringify(subscribeMessage));
    });
    loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'okx-${index}', status: 'subscribed' })));
  });

  socket.on('message', (event) => {
    const parsedMessage = JSON.parse(event);

    if (parsedMessage && parsedMessage.arg && parsedMessage.data) {
      const { arg, action, data } = parsedMessage;

      if (action === 'snapshot') {
        handleSnapshot(arg.instId, data[0]);
      } else if (action === 'update') {
        handleUpdate(arg.instId, data[0]);
      }
    }
  });

  socket.on('close', () => {
    console.log('close');
    loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'okx-${index}', status: 'disconnected' })));
    setTimeout(async () => {
      await main();
      loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'okx-${index}', status: 'reconnecting' })));
    }, 2000);
  });

  socket.on('error', (error) => {
    loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'okx-${index}', status: 'error', error: error })));
    socket.close();
  });

  socket.on('ping', () => {
    loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'okx-${index}', status: 'pong' })));
    socket.pong();
  });

  setInterval(() => {
    socket.send(JSON.stringify({
      op: 'ping'
    }));
    loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'okx-${index}', status: 'ping' })));
    console.log('PING');
  }, 5000);

  ['exit', 'SIGINT', 'SIGUSR1', 'SIGUSR2', 'uncaughtException', 'SIGTERM'].forEach((eventType) => {
    process.on(eventType, () => {
      loggingChannel.sendToQueue('crawler-logs', Buffer.from(JSON.stringify({ market: 'okx-${index}', status: 'stopped' })));
      setTimeout(() => {
        process.exit();
      }, 2000);
    });
  });

  function handleSnapshot(coin, data) {
    orderBooks[coin] = {
      bids: data.bids.map(parseDepthData),
      asks: data.asks.map(parseDepthData)
    };

    sortOrderBook(orderBooks[coin]);
    printOrderBook(coin);
  }

  function handleUpdate(coin, data) {
    const updatedBids = data.bids.map(parseDepthData);
    const updatedAsks = data.asks.map(parseDepthData);

    mergeOrderBook(orderBooks[coin].bids, updatedBids, true);
    mergeOrderBook(orderBooks[coin].asks, updatedAsks, false);

    printOrderBook(coin);
  }

  function parseDepthData(depth) {
    return {
      price: parseFloat(depth[0]),
      size: parseFloat(depth[1])
    };
  }

  function mergeOrderBook(fullOrderBook, incrementalData, isBid) {
    incrementalData.forEach(newLevel => {
      const existingIndex = fullOrderBook.findIndex(level => level.price === newLevel.price);

      if (existingIndex !== -1) {
        if (newLevel.size === 0) {
          fullOrderBook.splice(existingIndex, 1);
        } else {
          fullOrderBook[existingIndex].size = newLevel.size;
        }
      } else if (newLevel.size > 0) {
        fullOrderBook.push(newLevel);
      }
    });

    sortOrderBook({ bids: isBid ? fullOrderBook : [], asks: isBid ? [] : fullOrderBook });
  }

  function sortOrderBook(orderBook) {
    orderBook.bids.sort((a, b) => b.price - a.price);
    orderBook.asks.sort((a, b) => a.price - b.price);
  }

  function printOrderBook(coinName) {
    const lastSendTime = LastSendTime.get(coinName);
    const currentTime = Date.now();
    const lastSendMS = currentTime - lastSendTime;
    if (lastSendMS < SEND_INTERVAL) {
      return;
    }
    const cmcId = SymbolStore.get(coinName);

    const asks = orderBooks[coinName].asks.map(({price, size}) => [price, size])
    const bids = orderBooks[coinName].bids.map(({price, size}) => [price, size])

    channel.sendToQueue('okx', Buffer.from(JSON.stringify({ cmcId, bids, asks })));
  }
}

main();
`;