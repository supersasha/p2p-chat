import fs from 'fs/promises';

import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap } from '@libp2p/bootstrap';
import { identify, Identify } from '@libp2p/identify';
import { kadDHT, removePrivateAddressesMapper, KadDHT } from '@libp2p/kad-dht';
import { tcp } from '@libp2p/tcp';
import { createLibp2p, Libp2p } from 'libp2p';
import { createEd25519PeerId } from '@libp2p/peer-id-factory';
import { generateKeyPair, privateKeyFromRaw, publicKeyFromRaw } from '@libp2p/crypto/keys';
import { PrivateKey, Stream } from '@libp2p/interface';
import { peerIdFromPrivateKey, peerIdFromPublicKey } from '@libp2p/peer-id';
import { LengthPrefixedStream, lpStream } from 'it-length-prefixed-stream';
import * as commander from 'commander';
import { WebSocketServer, WebSocket } from 'ws';

import bootstrappers from './bootstrappers.js'

const PRIVATE_KEY_PATH = 'privatekey.txt';

function publicKeyFromBase64(pubKeyB64: string) {
  const buf = Buffer.from(pubKeyB64, 'base64');
  return publicKeyFromRaw(buf);
}

async function getPrivateKey(privKeyPath = PRIVATE_KEY_PATH): Promise<PrivateKey> {
  try {
    await fs.access(privKeyPath, fs.constants.R_OK);
    const content = await fs.readFile(privKeyPath, { encoding: 'utf8' });
    const buf = Buffer.from(content, 'base64');
    return privateKeyFromRaw(buf);
  } catch (err) {
    console.error('Error reading private key:', err);
    const privateKey = await generateKeyPair('Ed25519', 2048);
    const str = Buffer.from(privateKey.raw).toString('base64');
    await fs.writeFile(privKeyPath, str);
    return privateKey;
  }
}
/*
async function createPeerId() {
  const privateKey = await getPrivateKey();
  const peerId = peerIdFromPrivateKey(privateKey);
  return peerId;
}
*/

type MessageFromUI = {
  type: 'new-message';
  text: string;
};

type MessageToUI = {
  type: 'new-message';
  text: string;
};

async function main() {
  const program = new commander.Command();
  program.option('-k, --private-key <path>', 'Private key file path')
    .option('-f, --friend-key <base64>', 'Friend\'s public key (base64)')
    .option('-p, --port <number>', 'Websocket server port', (p) => parseInt(p, 10));
  program.parse();
  const options = program.opts();

  //const [_n, _s, privKeyPath, friendPubKeyB64] = process.argv;
  const privateKey = await getPrivateKey(options.privateKey);
  const publicKeyB64 = Buffer.from(privateKey.publicKey.raw).toString('base64');
  console.log('My public key:', publicKeyB64);
  //const peerId = await peerIdFromPrivateKey(privateKey);
  //console.log('My Peer ID:', peerId.toString());

  const node = await createLibp2p({
    addresses: {
      listen: ['/ip4/0.0.0.0/tcp/0']
    },
    transports: [tcp()],
    streamMuxers: [yamux()],
    connectionEncrypters: [noise()],
    peerDiscovery: [
      bootstrap({
        list: bootstrappers
      })
    ],
    services: {
      kadDHT: kadDHT({
        protocol: '/ipfs/kad/1.0.0',
        peerInfoMapper: removePrivateAddressesMapper,
        clientMode: false
      }),
      identify: identify()
    },
    privateKey,
  });
  
  node.addEventListener('peer:connect', (evt) => {
    const peerId = evt.detail
    console.log('Connection established to:', peerId.toString()) // Emitted when a peer has been found
  })

  node.addEventListener('peer:discovery', (evt) => {
    const peerInfo = evt.detail

    console.log('Discovered:', peerInfo.id.toString())
  })

  console.log('My peerId:', node.peerId);

  const stream: LengthPrefixedStream<Stream> = await getStream(options.friendKey, node);

  const wss = new WebSocketServer({ port: options.port || 8500 });
  const ws: WebSocket = await new Promise((resolve) => wss.on('connection', resolve));

  ws.on('message', async (buf) => {
    const json = buf.toString('utf8');
    const msgFromUI: MessageFromUI = JSON.parse(json);
    if (msgFromUI.type === 'new-message') {
      await stream.write(Buffer.from(msgFromUI.text, 'utf8'));
    }
  });

  while (true) {
    const ans = await stream.read();
    const textFromFriend = Buffer.from(ans.subarray(0, ans.length)).toString('utf8');
    const msg: MessageToUI = {
      type: 'new-message',
      text: textFromFriend
    };
    ws.send(JSON.stringify(msg));
  }
}

main();


async function getStream(friendKey: string | undefined, node: Libp2p<{ kadDHT: KadDHT; identify: Identify; }>): Promise<LengthPrefixedStream<Stream>> {
  if (friendKey) {
    const friendPubKey = publicKeyFromBase64(friendKey);
    const friendPeerId = peerIdFromPublicKey(friendPubKey);
    console.log('Looking for friend peer...', friendPeerId);
    const peerInfo = await node.peerRouting.findPeer(friendPeerId);
    console.log('Friend peer info:', peerInfo);

    const duplex = await node.dialProtocol(friendPeerId, '/xyz-chat/1.0.0');
    return lpStream(duplex);
  } else {
    return await new Promise(async (resolve) => {
      await node.handle('/xyz-chat/1.0.0', async ({ stream: duplex, connection }) => {
        //if (connection.remotePeer ===)
        const stream = lpStream(duplex);
        resolve(stream);
      });
    });
  }
}
