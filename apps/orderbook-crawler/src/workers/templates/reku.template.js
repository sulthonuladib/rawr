const HOST = require('../../constants/hostname.constant');

const rekuOrderbookTemplate = (id, coinName) => {
    return `
const { io } = require('socket.io-client');
const axios = require('axios');

const API_URL = 'https://api.reku.id/v2/orderbook?id=${id}'
let data = null;

const socket = io("ws://${HOST}:6003/reku", {
    path: "/ws",
    transports: ["websocket"],
    parser: require("socket.io-msgpack-parser"),
});

socket.on('connect', () => {
    console.log('CONNECTED', socket.connected);
})

setInterval(async () => {
    try {
        data = await axios(API_URL).then(({ data }) => data)
        if (data === null || data === undefined) {
            return;
        }
        const { s: asks, b: bids } = data;
        socket.emit('stream:reku', { coinName: '${coinName}', asks, bids });
    } catch (error) {
        console.log('ERROR fetch', error);
    }
}, 1000)

socket.on('disconnect', (reason) => {
    console.log('DISCONNECT', socket.disconnected, reason);
})

socket.on('error', (error) => {
    console.log(error);
});
    `
};

module.exports = rekuOrderbookTemplate;
