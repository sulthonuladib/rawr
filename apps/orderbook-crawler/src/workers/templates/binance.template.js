const HOST = require('../../constants/hostname.constant');

module.exports = (coinName) => {
    return `
const { io } = require('socket.io-client');
const WebSocket = require('ws');
const moment = require("moment")

const WS_URL = 'wss://stream.binance.com:9443/ws';

const socket = io("ws://${HOST}:6001/binance", {
    path: "/ws",
    transports: ["websocket"],
    parser: require("socket.io-msgpack-parser"),
});

socket.on('connect', () => {
    console.log("${coinName}-binance-connected-local-" + moment().format("DD/MM/YYYY@hh:mm:ss"));
})

socket.on('disconnect', (reason) => {
    console.error("${coinName}-binance-disconnected-local-" + moment().format("DD/MM/YYYY@hh:mm:ss"));
})

function main() {
    const marketStream = new WebSocket(WS_URL + '/${coinName}usdt@depth20@1000ms');
    marketStream.on('open', () => {
        console.log("${coinName}-binance-connected-marketstream-" + moment().format("DD/MM/YYYY@hh:mm:ss"));
    });
    marketStream.on('message', (message) => {
        if (socket.connected) {
            const { asks, bids } = JSON.parse(message);
            socket.timeout(1000).emit("stream:binance", {
                coinName: "${coinName}",
                asks,
                bids,
            });
        }
    })

    marketStream.on("close", () => {
        console.error("${coinName}-binance-disconnected-reconnecting-" + moment().format("DD/MM/YYYY@hh:mm:ss"));
        setTimeout(() => {
            main();
        }, 2000);
    });

    marketStream.on("error", (error) => {
        console.error("${coinName}-binance-error-closing-" + moment().format("DD/MM/YYYY@hh:mm:ss"));
        marketStream.close();
    });
}

main();
`;
};