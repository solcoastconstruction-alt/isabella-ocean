// Entry point for web/vendor/solana.js (built by `npm run bundle`).
// The IIFE exposes window.SolanaLib = { web3, splStakePool, splToken, Buffer, bs58, sha256 }.
// web3, splStakePool and splToken are the namespaces the payments code is written against;
// Buffer, bs58 and sha256 are the same instances those libraries use internally, exported so the
// plain-script app code (wallet.js, payments.js, entitlement.js) never needs its own copies.
import * as web3 from '@solana/web3.js';
import * as splStakePool from '@solana/spl-stake-pool';
import * as splToken from '@solana/spl-token';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { sha256 } from '@noble/hashes/sha256';

export { web3, splStakePool, splToken, Buffer, bs58, sha256 };
