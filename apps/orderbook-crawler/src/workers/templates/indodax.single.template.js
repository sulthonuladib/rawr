const HOST = require('../../constants/hostname.constant');

module.exports = (coinName) => {
    let subName = coinName;
    if (subName === 'aave') subName = 'lend'
    if (subName === 'xlm') subName = 'str'
    if (subName === 'dash') subName = 'drk'
    if (subName === 'luna') subName = 'lunav2'
    if (subName === 'xem') subName = 'nem'
    if (subName === 'usdp') subName = 'pax'
    if (subName === 't') subName = 'threshold'
    if (subName === 'xdc') subName = 'xdce'
    if (subName === 'bsv') subName = 'bchsv'
    if (subName === '1inch') subName = 'oneinch'
    if (subName === 'gala') subName = 'galagames'
    return `
const { io } = require('socket.io-client');
const WebSocket = require('ws');
const Centrifuge = require('centrifuge');
const moment = require("moment");

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE5NDY2MTg0MTV9.UR1lBM6Eqh0yWz-PVirw1uPCxe60FdchR8eNVdsskeo"

const WS_URL = 'wss://ws3.indodax.com/ws/';
const socket = io('ws://${HOST}:6001/indodax', {
    path: '/ws',
  transports: ['websocket'],
    parser: require("socket.io-msgpack-parser")
});

socket.on('connect', () => {
    console.log("${coinName}-indodax-connected-local-" + moment().format("DD/MM/YYYY@hh:mm:ss"));
})

socket.on('disconnect', (reason) => {
    console.error("${coinName}-indodax-disconnected-local-" + moment().format("DD/MM/YYYY@hh:mm:ss"));
})

const marketStream = new Centrifuge(WS_URL, { websocket: WebSocket });

function main() {

    marketStream.setToken(token);

    marketStream.connect();

    marketStream.on('connect', () => {
        console.log("${coinName}-indodax-connected-marketstream-" + moment().format("DD/MM/YYYY@hh:mm:ss"));

        marketStream.subscribe('market:order-book-${subName}idr', (message) => {
            if (socket.connected) {
                const { ask, bid } = message.data;
                socket.timeout(1000).emit('stream:indodax', { coinName: '${coinName}', asks: ask, bids: bid });
            }
        })
    })

    marketStream.on('close', () => {
        console.error("${coinName}-indodax-disconnected-reconnecting-" + moment().format("DD/MM/YYYY@hh:mm:ss"));
        main();
    });

    marketStream.on('error', (error) => {
        console.error("${coinName}-indodax-error-closing-" + moment().format("DD/MM/YYYY@hh:mm:ss"));
        marketStream.close();
    })
}

main();
`;
};