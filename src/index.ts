import fs from 'fs/promises';

import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap } from '@libp2p/bootstrap';
import { identify } from '@libp2p/identify';
import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht';
import { tcp } from '@libp2p/tcp';
import { createLibp2p } from 'libp2p';
import { createEd25519PeerId } from '@libp2p/peer-id-factory';
import { generateKeyPair, privateKeyFromRaw, publicKeyFromRaw } from '@libp2p/crypto/keys';
import { PrivateKey } from '@libp2p/interface';
import { peerIdFromPrivateKey, peerIdFromPublicKey } from '@libp2p/peer-id';

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

async function main() {
  const [_n, _s, privKeyPath, friendPubKeyB64] = process.argv;
  const privateKey = await getPrivateKey(privKeyPath);
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

  console.log('My peerId:', node.peerId);

  if (friendPubKeyB64) {
    const friendPubKey = publicKeyFromBase64(friendPubKeyB64);
    const friendPeerId = peerIdFromPublicKey(friendPubKey);
    console.log('Looking for friend peer...');
    const peerInfo = await node.peerRouting.findPeer(friendPeerId);
    console.log('Friend peer info:', peerInfo);
  }
}

main();

/*
  //node.contentRouting.provide(cid)

  // !!! First
  // !!! node.contentRouting.put(someKey, peerId);
  // Then find peerId by known key
  //const str = Buffer.from("123456").toString('base64url');
  //Buffer.from(str, 'base64url');


  node.addEventListener('peer:connect', (evt) => {
    const peerId = evt.detail
    //console.log('Connection established to:', peerId.toString()) // Emitted when a peer has been found
  })

  node.addEventListener('peer:discovery', (evt) => {
    const peerInfo = evt.detail

    //console.log('Discovered:', peerInfo.id.toString())
  })
*/

//const peerInfo = await node.peerRouting.findPeer(node.peerId);
//console.log("My peer info:", peerInfo);


/*
import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht'
import { createLibp2p } from 'libp2p';
import { peerIdFromString } from '@libp2p/peer-id';
import { identify } from '@libp2p/identify';

async function main() {
  const node = await createLibp2p({
    services: {
      aminoDHT: kadDHT({
        protocol: '/ipfs/kad/1.0.0',
        peerInfoMapper: removePrivateAddressesMapper
      }),
      identify: identify(),
    }
  })

  const peerId = peerIdFromString('QmFoo')
  const peerInfo = await node.peerRouting.findPeer(peerId)

  console.info(peerInfo) // peer id, multiaddrs
}

main();
*/
