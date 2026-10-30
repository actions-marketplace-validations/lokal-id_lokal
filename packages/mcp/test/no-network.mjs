// Preloaded with `node --import` by offline.test.ts: every way Node can reach the network throws, and each attempt
// is appended to the file in LOKAL_NETWORK_LOG, so a test can prove a process never tried.
import { appendFileSync } from 'node:fs';
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const log = process.env.LOKAL_NETWORK_LOG;
const refuse = (what) =>
  function blocked(...args) {
    const target = typeof args[0] === 'object' ? JSON.stringify(args[0])?.slice(0, 200) : String(args[0]);
    if (log) appendFileSync(log, `${what} ${target}\n`);
    throw new Error(`network access blocked in this test: ${what}`);
  };

net.Socket.prototype.connect = refuse('net.Socket.connect');
net.connect = net.createConnection = refuse('net.connect');
tls.connect = refuse('tls.connect');
http.request = http.get = refuse('http.request');
https.request = https.get = refuse('https.request');
dgram.createSocket = refuse('dgram.createSocket');
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) {
  dns[name] = refuse(`dns.${name}`);
  dns.promises[name] = refuse(`dns.promises.${name}`);
}
globalThis.fetch = refuse('fetch');
globalThis.WebSocket = refuse('WebSocket');
