module.exports = (symbols, index) => `
const WebSocket = require("ws");
const amqp = require("amqplib");
const { EXIT_EVENTS } = require("../../constants/exit-event.constant");
const MARKET = "indodax";
const LOG_ID = ${index};
const MARKET_LOG_ID = MARKET + "-" + LOG_ID;

const token =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE5NDY2MTg0MTV9.UR1lBM6Eqh0yWz-PVirw1uPCxe60FdchR8eNVdsskeo";

const SymbolStore = new Map();
const { IndodaxSubscribeMap } = require("../../utils/IndodaxSubscribeMap");

/**
 * @param {[string, number][]} metadata
 * @param {import("amqplib").Channel} amqpChannel
 */
function stream(metadata, amqpChannel) {
  const socket = new WebSocket("wss://ws3.indodax.com/ws/");

  socket.on("open", () => {
    console.log("socket:open");
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(
        JSON.stringify({ market: MARKET_LOG_ID, status: "connected" }),
      ),
    );
    socket.send(
      JSON.stringify({
        params: {
          token: token,
        },
        id: 1,
      }),
    );

    let subscribeId = 1;
    for (let [channel, cmcId] of metadata) {
      if (IndodaxSubscribeMap.has(cmcId)) {
        channel = "market:order-book-" + IndodaxSubscribeMap.get(cmcId) + "idr";
      }
      SymbolStore.set(channel, cmcId);
      console.log(channel, cmcId);
      socket.send(
        JSON.stringify({
          method: 1,
          params: {
            channel,
          },
          id: subscribeId,
        }),
      );
      subscribeId++;
    }
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(
        JSON.stringify({ market: MARKET_LOG_ID, status: "subscribed" }),
      ),
    );
  });

  socket.on("message", (message) => {
    const parsed = stupidParser(message);
    if (!parsed) return;
		if (!("result" in parsed)) return;
    if ("data" in parsed.result) {
      const { data, channel } = parsed.result;
      const { ask, bid } = data.data;
      const cmcId = SymbolStore.get(channel);

      amqpChannel.sendToQueue(
        MARKET,
        Buffer.from(JSON.stringify({ cmcId, ask, bid })),
      );
    } else {
      return;
    }

    // if (isJSON(message) === true) {
    //   const messageParse = JSON.parse(message);
    //   console.log(messageParse);
    //   const { id } = messageParse;
    //   if (id === undefined) {
    //     const {
    //       result: { data, channel: socketStreamChannel },
    //     } = messageParse;
    //
    //     if (data != undefined) {
    //       const { ask, bid } = data.data;
    //       const cmcId = SymbolStore.get(socketStreamChannel);
    //
    //       amqpChannel.sendToQueue(
    //         MARKET,
    //         Buffer.from(JSON.stringify({ cmcId, ask, bid })),
    //       );
    //     }
    //   }
    // }
  });

  const pingInterval = setInterval(() => {
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(JSON.stringify({ market: MARKET_LOG_ID, status: "ping" })),
    );
    socket.send(
      JSON.stringify({
        method: 7,
        id: 3,
      }),
    );
  }, 1000 * 60);

  socket.on("close", () => {
    clearInterval(pingInterval);
    console.log("socket:close");
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(JSON.stringify({ market: MARKET_LOG_ID, status: "closed" })),
    );

    setTimeout(() => {
      console.log("socket:reconnecting");
      amqpChannel.sendToQueue(
        "crawler-logs",
        Buffer.from(
          JSON.stringify({ market: MARKET_LOG_ID, status: "reconnecting" }),
        ),
      );
      stream(metadata, amqpChannel);
    }, 2000);
  });

  socket.on("error", (_) => {
    console.error("socket:error");
    amqpChannel.sendToQueue(
      "crawler-logs",
      Buffer.from(JSON.stringify({ market: MARKET_LOG_ID, status: "error" })),
    );
    socket.close();
  });
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
    return ["market:order-book-" + symbol + "idr", Number(cmcId)];
  });
}

async function main() {
  const args = ${JSON.stringify(symbols)}
		.map((x) => x.symbol + ":" + x.cmcId)
    .join(",");
  console.log("");
  const symbols = parseArgs(args);
  const amqpConnection = await amqp.connect(
    process.env.AMQP_URL || "amqp://localhost",
  );
  const amqpChannel = await amqpConnection.createChannel();

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

function stupidParser(str) {
	try {
		const data = str
			.toString()
			.split("\\n")
			.filter((r) => r !== "")
			.map((r) => JSON.parse(r));
		return data[0];
	} catch (error) {
		console.log("parsing:error", error);
		return false;
	}

	// try {
	//   const data = JSON.parse(str);
	//   return data;
	// } catch (e) {
	//   return false;
	// }
}

main();
`;