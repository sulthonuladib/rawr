import HOST from "../../constants/hostname.constant.js";

export const huobiOrderbookTemplate = (coinName: string): string => {
    return `
const { io } = require("socket.io-client");
const pako = require("pako");
const WebSocket = require("ws");
const moment = require("moment")

const WS_URL = "wss://api.huobi.pro/ws";

const socket = io("ws://${HOST}:6001/huobi", {
    path: "/ws",
    transports: ["websocket"],
    parser: require("socket.io-msgpack-parser"),
});

socket.on("connect", () => {
    console.log("${coinName}-huobi-connected-local-" + moment().format("DD/MM/YYYY@hh:mm:ss"));
});

let dataBuffer = null;

function sendBufferedData() {
    dataToSend = dataBuffer;
    if (dataToSend) {
        socket.emit("stream:huobi", dataToSend);
    }

    dataBuffer = null;

    setTimeout(sendBufferedData, 1000);
}

function main() {
    const marketStream = new WebSocket(WS_URL);
    marketStream.on("open", () => {
        console.log("${coinName}-huobi-connected-marketstream-" + moment().format("DD/MM/YYYY@hh:mm:ss"));
        const subscribe = {
            sub: 'market.${coinName}usdt.depth.step1',
            id: 'id1',
        };

        marketStream.send(JSON.stringify(subscribe), (error) => {
            if (error) {
                console.error("${coinName}-huobi-error-subscribtion-" + moment().format("DD/MM/YYYY@hh:mm:ss"));
            }
        });
    });

    marketStream.on("message", async (message) => {
        let text = pako.inflate(message, { to: "string" });
        let msg = JSON.parse(text);

        if (msg.ping) {
            marketStream.send(JSON.stringify({ pong: msg.ping }));
        } else if (msg.tick) {
            let coinName = msg.ch.split(".")[1];
            coinName = coinName.slice(0, -4);
            if (coinName.toLowerCase() === "holo") coinName = "hot";
            const { asks, bids } = msg.tick;
            dataBuffer = { coinName, asks, bids };
        } else {
            // console.log('Unknown message: ${coinName}', msg);
        }
    });

    marketStream.on("close", () => {
        console.error("${coinName}-huobi-disconnected-reconnecting-" + moment().format("DD/MM/YYYY@hh:mm:ss"));
        setTimeout(() => {
            main();
        }, 2000);
    });

    marketStream.on("error", (error) => {
        console.error("${coinName}-huobi-error-closing-" + moment().format("DD/MM/YYYY@hh:mm:ss"));
        marketStream.close();
    });
}

setTimeout(sendBufferedData, 1000);

main();
    `;
}