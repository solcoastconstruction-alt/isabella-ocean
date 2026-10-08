/* Pool manager plans: read, check and describe the instruction file that pool/create-pool.mjs and
 * pool/collect-fees.mjs write with --plan-out, so a phone wallet can sign the manager's steps.
 *
 * Debug builds only (src/debug/assets). Used by pool-manager.html on the phone and, unchanged, by
 * pool/lib/plan.mjs on the Mac (it evaluates this file), so both sides describe a plan with one decoder.
 * No dependencies and no network: bytes in, plain objects out.
 *
 * Layouts are from the SPL stake-pool program, program@v2.1.0 instruction.rs (enum
 * StakePoolInstruction: Borsh, u8 variant index, little-endian integers, String = u32 length + UTF-8)
 * and state.rs (struct Fee { denominator, numerator }: the denominator comes FIRST).
 */
(function (root) {
  'use strict';

  var FORMAT = 'isabella-pool-plan/1';

  var CLUSTERS = {
    devnet: {
      label: 'DEVNET', chain: 'solana:devnet', genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
      stakePoolProgram: 'DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib', explorerSuffix: '?cluster=devnet',
    },
    mainnet: {
      label: 'MAINNET', chain: 'solana:mainnet', genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
      stakePoolProgram: 'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy', explorerSuffix: '',
    },
  };

  var WELL_KNOWN = {
    '11111111111111111111111111111111': 'System program',
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': 'SPL Token program',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb': 'SPL Token-2022 program',
    'Stake11111111111111111111111111111111111111': 'Stake program',
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s': 'Metaplex Token Metadata program',
    'SysvarC1ock11111111111111111111111111111111': 'Clock sysvar',
    'SysvarStakeHistory1111111111111111111111111': 'Stake history sysvar',
    'SysvarRent111111111111111111111111111111111': 'Rent sysvar',
    'DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib': 'SPL stake-pool program (devnet build)',
    'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy': 'SPL stake-pool program (mainnet)',
  };

  // ---------------------------------------------------------------- bytes
  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  function b58encode(bytes) {
    var n = 0n, i, out = '';
    for (i = 0; i < bytes.length; i++) n = (n << 8n) | BigInt(bytes[i]);
    while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
    for (i = 0; i < bytes.length && bytes[i] === 0; i++) out = '1' + out;
    return out;
  }

  function b58decode(s) {
    if (typeof s !== 'string' || !s.length) throw new Error('not base58: ' + s);
    var n = 0n, i, idx, out = [];
    for (i = 0; i < s.length; i++) {
      idx = B58.indexOf(s[i]);
      if (idx < 0) throw new Error('not base58: ' + s);
      n = n * 58n + BigInt(idx);
    }
    while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
    for (i = 0; i < s.length && s[i] === '1'; i++) out.unshift(0);
    return Uint8Array.from(out);
  }

  function isPubkey(s) {
    try { return b58decode(s).length === 32 && b58encode(b58decode(s)) === s; } catch (e) { return false; }
  }

  function hexToBytes(hex) {
    if (typeof hex !== 'string' || hex.length % 2 || /[^0-9a-f]/.test(hex)) throw new Error('not lower-case hex: ' + hex);
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function bytesToHex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  var B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function b64urlEncode(bytes) {
    var out = '', i, a, b, c;
    for (i = 0; i < bytes.length; i += 3) {
      a = bytes[i]; b = bytes[i + 1]; c = bytes[i + 2];
      out += B64URL[a >> 2] + B64URL[((a & 3) << 4) | ((b === undefined ? 0 : b) >> 4)];
      if (b !== undefined) out += B64URL[((b & 15) << 2) | ((c === undefined ? 0 : c) >> 6)];
      if (c !== undefined) out += B64URL[c & 63];
    }
    return out;
  }

  function b64urlDecode(s) {
    if (typeof s !== 'string' || /[^A-Za-z0-9_-]/.test(s) || s.length % 4 === 1) throw new Error('not base64url');
    var out = [], i, v = 0, bits = 0;
    for (i = 0; i < s.length; i++) {
      v = (v << 6) | B64URL.indexOf(s[i]); bits += 6;
      if (bits >= 8) { bits -= 8; out.push((v >> bits) & 255); }
    }
    return Uint8Array.from(out);
  }

  function utf8Decode(bytes) {
    // strict: a plan must be valid UTF-8 (TextDecoder exists in WebView and in Node)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  function Reader(bytes) { this.b = bytes; this.o = 0; }
  Reader.prototype.need = function (n) { if (this.o + n > this.b.length) throw new Error('data is too short'); };
  Reader.prototype.u8 = function () { this.need(1); return this.b[this.o++]; };
  Reader.prototype.u32 = function () {
    this.need(4);
    var v = this.b[this.o] + this.b[this.o + 1] * 256 + this.b[this.o + 2] * 65536 + this.b[this.o + 3] * 16777216;
    this.o += 4;
    return v;
  };
  Reader.prototype.u64 = function () {
    this.need(8);
    var v = 0n;
    for (var i = 7; i >= 0; i--) v = (v << 8n) | BigInt(this.b[this.o + i]);
    this.o += 8;
    return v;
  };
  Reader.prototype.fee = function () { var d = this.u64(); var n = this.u64(); return { numerator: n, denominator: d }; };
  Reader.prototype.string = function () {
    var len = this.u32();
    this.need(len);
    var s = utf8Decode(this.b.subarray(this.o, this.o + len));
    this.o += len;
    return s;
  };
  Reader.prototype.end = function () { if (this.o !== this.b.length) throw new Error((this.b.length - this.o) + ' unexpected extra byte(s) of data'); };

  // ---------------------------------------------------------------- words
  /** "3/1000 = 0.3%"; a zero numerator or denominator is 0% (state.rs Fee::apply). */
  function feeText(f) {
    var n = BigInt(f.numerator), d = BigInt(f.denominator);
    var frac = n + '/' + d;
    if (n === 0n || d === 0n) return frac + ' = 0%';
    if (n > d) return frac + ' = MORE THAN 100% (invalid)';
    var millionths = (n * 100000000n) / d; // percent with 6 decimal places
    var whole = millionths / 1000000n, part = (millionths % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
    return frac + ' = ' + whole + (part ? '.' + part : '') + '%';
  }

  /** 9-decimal amount (lamports, or OCEAN base units) as a decimal string with no float maths. */
  function amount9(v) {
    var x = BigInt(v);
    var whole = x / 1000000000n, part = (x % 1000000000n).toString().padStart(9, '0');
    return whole + '.' + part;
  }

  var FEE_TYPES = ['SolReferral', 'StakeReferral', 'Epoch', 'StakeWithdrawal', 'SolDeposit', 'StakeDeposit', 'SolWithdrawal'];
  var FEE_TYPE_WORDS = {
    SolReferral: 'share of the SOL deposit fee paid to a referrer',
    StakeReferral: 'share of the stake deposit fee paid to a referrer',
    Epoch: 'fee on staking rewards (epoch fee)',
    StakeWithdrawal: 'fee on stake withdrawals (the free exit)',
    SolDeposit: 'fee on SOL deposits',
    StakeDeposit: 'fee on stake deposits',
    SolWithdrawal: 'fee on SOL withdrawals (the instant exit)',
  };
  var FUNDING_TYPES = ['StakeDeposit', 'SolDeposit', 'SolWithdraw'];
  var FUNDING_WORDS = {
    StakeDeposit: 'who may deposit stake accounts',
    SolDeposit: 'who may deposit SOL (set = parents can no longer deposit by themselves)',
    SolWithdraw: 'who may withdraw SOL (set = parents can no longer exit instantly by themselves)',
  };

  // ---------------------------------------------------------------- stake-pool instructions
  // flags: 'w' writable, 's' signer, 'sw' both, 'r' read-only. `managerSigned` marks instructions that only
  // the pool's manager may send: before one goes out, the page checks the pool's manager on chain.
  // `more`: what any accounts past the fixed list are.
  var STAKE_POOL_IX = {
    0: {
      name: 'Initialize',
      accounts: [['stake pool (new, empty)', 'w'], ['manager', 's'], ['staker', 'r'], ['withdraw authority (PDA)', 'r'],
        ['validator list (new, empty)', 'w'], ['reserve stake account', 'r'], ['pool token mint', 'w'],
        ['manager fee account', 'w'], ['token program', 'r']],
      optional: [['deposit authority (restricts ALL deposits to this signer)', 's']],
      read: function (r) {
        var epoch = r.fee(), withdrawal = r.fee(), deposit = r.fee(), referral = r.u8(), max = r.u32();
        return [
          ['Fee on rewards (epoch fee)', feeText(epoch)],
          ['Withdrawal fee (SOL and stake)', feeText(withdrawal)],
          ['Deposit fee (SOL and stake)', feeText(deposit)],
          ['Referral share of deposit fees', referral + '%'],
          ['Most validators the pool can hold', String(max)],
        ];
      },
    },
    6: {
      name: 'UpdateValidatorListBalance', permissionless: true,
      accounts: [['stake pool', 'r'], ['withdraw authority (PDA)', 'r'], ['validator list', 'w'], ['reserve stake account', 'w'],
        ['clock sysvar', 'r'], ['stake history sysvar', 'r'], ['stake program', 'r']],
      more: ['validator or transient stake account', 'w'],
      read: function (r) { var start = r.u32(), noMerge = r.u8(); return [['First validator index', String(start)], ['Skip merging', noMerge ? 'yes' : 'no']]; },
    },
    7: {
      name: 'UpdateStakePoolBalance', permissionless: true,
      accounts: [['stake pool', 'w'], ['withdraw authority (PDA)', 'r'], ['validator list', 'w'], ['reserve stake account', 'r'],
        ['manager fee account', 'w'], ['pool token mint', 'w'], ['token program', 'r']],
      read: function () { return []; },
    },
    8: {
      name: 'CleanupRemovedValidatorEntries', permissionless: true,
      accounts: [['stake pool', 'w'], ['validator list', 'w']],
      read: function () { return []; },
    },
    11: {
      name: 'SetManager', managerSigned: true,
      accounts: [['stake pool', 'w'], ['manager', 's'], ['NEW manager', 's'], ['NEW manager fee account', 'r']],
      read: function () { return [['Effect', 'hands the pool to a new manager and a new fee account']]; },
    },
    12: {
      name: 'SetFee', managerSigned: true,
      accounts: [['stake pool', 'w'], ['manager', 's']],
      read: function (r) {
        var t = r.u8(), type = FEE_TYPES[t];
        if (!type) throw new Error('unknown fee type ' + t);
        var value = (type === 'SolReferral' || type === 'StakeReferral') ? r.u8() + '%' : feeText(r.fee());
        return [['Which fee', type + ': ' + FEE_TYPE_WORDS[type]], ['New value', value]];
      },
    },
    13: {
      name: 'SetStaker', managerSigned: true, // the current staker may also send it; the page still checks the manager
      accounts: [['stake pool', 'w'], ['manager (or current staker)', 's'], ['NEW staker', 'r']],
      read: function () { return [['Effect', 'changes who may add validators and move stake']]; },
    },
    15: {
      name: 'SetFundingAuthority', managerSigned: true,
      accounts: [['stake pool', 'w'], ['manager', 's']],
      optional: [['NEW authority', 'r']],
      read: function (r) {
        var t = r.u8(), type = FUNDING_TYPES[t];
        if (!type) throw new Error('unknown funding type ' + t);
        return [['Which authority', type + ': ' + FUNDING_WORDS[type]]];
      },
      after: function (d) {
        d.params.push(['New authority', d.accounts.length > 2 ? d.accounts[2].pubkey : 'NONE (back to the default: open to everyone for SOL, the pool’s own PDA for stake)']);
      },
    },
    16: {
      name: 'WithdrawSol',
      accounts: [['stake pool', 'w'], ['withdraw authority (PDA)', 'r'], ['owner of the tokens being burned', 's'],
        ['token account the pool tokens are burned from', 'w'], ['reserve stake account', 'w'], ['SOL goes to', 'w'],
        ['manager fee account', 'w'], ['pool token mint', 'w'], ['clock sysvar', 'r'], ['stake history sysvar', 'r'],
        ['stake program', 'r'], ['token program', 'r']],
      optional: [['SOL withdraw authority', 's']],
      read: function (r) { return [['Pool tokens to burn', amount9(r.u64()) + ' OCEAN']]; },
      after: withdrawSolNotes,
    },
    17: {
      name: 'CreateTokenMetadata', managerSigned: true,
      accounts: [['stake pool', 'r'], ['manager', 's'], ['withdraw authority (PDA)', 'r'], ['pool token mint', 'r'],
        ['payer of the metadata rent', 'sw'], ['token metadata account (new)', 'w'], ['Metaplex Token Metadata program', 'r'],
        ['system program', 'r']],
      read: function (r) { return [['Token name', r.string()], ['Token symbol', r.string()], ['Metadata URI', r.string()]]; },
    },
    18: {
      name: 'UpdateTokenMetadata', managerSigned: true,
      accounts: [['stake pool', 'r'], ['manager', 's'], ['withdraw authority (PDA)', 'r'], ['token metadata account', 'w'],
        ['Metaplex Token Metadata program', 'r']],
      read: function (r) { return [['Token name', r.string()], ['Token symbol', r.string()], ['Metadata URI', r.string()]]; },
    },
    26: {
      name: 'WithdrawSolWithSlippage',
      accounts: null, // same as WithdrawSol (set below)
      optional: [['SOL withdraw authority', 's']],
      read: function (r) {
        var tokens = r.u64(), min = r.u64();
        return [['Pool tokens to burn', amount9(tokens) + ' OCEAN'], ['At least this much SOL must come out', amount9(min) + ' SOL']];
      },
      after: withdrawSolNotes,
    },
  };
  STAKE_POOL_IX[26].accounts = STAKE_POOL_IX[16].accounts;

  function withdrawSolNotes(d) {
    var from = d.accounts[3].pubkey, feeAccount = d.accounts[6].pubkey;
    d.params.push(['Withdrawal fee', from === feeAccount
      ? 'none: the tokens come from the manager fee account itself (this is a fee collection)'
      : 'the pool’s SOL withdrawal fee applies (this is NOT a fee collection)']);
    d.feeCollection = from === feeAccount;
  }

  function flagsOf(a) { return (a.isSigner ? 's' : '') + (a.isWritable ? 'w' : '') || 'r'; }

  /**
   * Describe one instruction of a plan: { program, name, decoded, params: [[label, text]], accounts:
   * [{ role, pubkey, isSigner, isWritable, known }], problems: [text], managerSigned, permissionless }.
   * `decoded` is false, with a problem, for anything this file does not know byte for byte.
   */
  function describeInstruction(ix, cluster) {
    var d = { program: ix.programId, programName: WELL_KNOWN[ix.programId] || null, name: null, decoded: false, params: [], accounts: [], problems: [] };
    var accounts = Array.isArray(ix.accounts) ? ix.accounts : [];
    var data;
    try { data = hexToBytes(ix.dataHex); } catch (e) { d.problems.push('the instruction data is not hex'); data = new Uint8Array(0); }
    d.dataHex = typeof ix.dataHex === 'string' ? ix.dataHex : '';
    if (typeof ix.dataBase58 === 'string' && ix.dataBase58 !== b58encode(data)) d.problems.push('dataBase58 and dataHex disagree');

    var spec = null;
    if (!cluster || ix.programId !== CLUSTERS[cluster].stakePoolProgram) {
      d.problems.push('the program is not the ' + (cluster ? CLUSTERS[cluster].label + ' ' : '') + 'stake-pool program, so this instruction is not decoded');
    } else if (!data.length || !STAKE_POOL_IX[data[0]]) {
      d.problems.push('stake-pool instruction ' + (data.length ? data[0] : '(empty)') + ' is not one this page knows');
    } else {
      spec = STAKE_POOL_IX[data[0]];
      d.name = spec.name;
      d.managerSigned = !!spec.managerSigned;
      d.permissionless = !!spec.permissionless;
    }

    var fixed = spec ? spec.accounts.length : 0, optional = spec && spec.optional ? spec.optional.length : 0;
    if (spec && (accounts.length < fixed || (!spec.more && accounts.length > fixed + optional))) {
      d.problems.push(spec.name + ' takes ' + fixed + (optional ? ' to ' + (fixed + optional) : (spec.more ? ' or more' : '')) + ' accounts, not ' + accounts.length);
    }
    for (var i = 0; i < accounts.length; i++) {
      var a = accounts[i] || {};
      var want = !spec ? null : i < fixed ? spec.accounts[i] : spec.more ? spec.more : spec.optional && spec.optional[i - fixed];
      var entry = {
        role: want ? want[0] : 'account ' + (i + 1), pubkey: String(a.pubkey), isSigner: a.isSigner === true, isWritable: a.isWritable === true,
        known: WELL_KNOWN[a.pubkey] || null,
      };
      if (!isPubkey(a.pubkey)) d.problems.push('account ' + (i + 1) + ' is not an address');
      if (typeof a.isSigner !== 'boolean' || typeof a.isWritable !== 'boolean') d.problems.push('account ' + (i + 1) + ' has no signer/writable flags');
      if (want && flagsOf(entry) !== want[1]) d.problems.push(entry.role + ': the file says ' + words(flagsOf(entry)) + ' but ' + spec.name + ' needs ' + words(want[1]));
      d.accounts.push(entry);
    }

    if (spec && !d.problems.length) {
      try {
        var r = new Reader(data);
        r.u8();
        d.params = spec.read(r).map(function (p) { return [p[0], p[1]]; });
        r.end();
        if (spec.after) spec.after(d);
        d.decoded = true;
      } catch (e) {
        d.params = [];
        d.problems.push(spec.name + ' data does not decode: ' + e.message);
      }
    }
    return d;
  }

  function words(flags) {
    return { r: 'read-only', w: 'writable', s: 'signer', sw: 'signer + writable' }[flags] || flags;
  }

  // ---------------------------------------------------------------- the plan file
  /**
   * Check a parsed plan and describe every instruction. Returns { ok, errors: [text], warnings: [text],
   * cluster, clusterInfo, signer, steps: [{ title, instructions: [described], managerSigned, initialize:
   * { pool, manager, staker, managerFeeAccount } | null, pools: [address] }] }.
   * Nothing may be signed unless ok is true.
   */
  function checkPlan(plan) {
    var out = { ok: false, errors: [], warnings: [], cluster: null, clusterInfo: null, signer: null, steps: [] };
    var err = function (m) { out.errors.push(m); };
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) { err('the plan is not a JSON object'); return out; }
    if (plan.format !== FORMAT) err('unknown plan format ' + JSON.stringify(plan.format) + ' (this page reads ' + FORMAT + ')');

    // The cluster comes from the file and nowhere else. No default, no guess.
    if (plan.cluster !== 'devnet' && plan.cluster !== 'mainnet') {
      err('the plan does not name its cluster (devnet or mainnet)');
      return out;
    }
    out.cluster = plan.cluster;
    out.clusterInfo = CLUSTERS[plan.cluster];
    if (plan.genesisHash !== out.clusterInfo.genesisHash) err('the plan’s genesis hash is not ' + out.clusterInfo.label + '’s');
    if (plan.chain !== out.clusterInfo.chain) err('the plan’s wallet chain is not ' + out.clusterInfo.chain);
    if (plan.cluster === 'mainnet' && plan.allowMainnet !== 'yes') {
      err('this is a MAINNET plan made without POOL_ALLOW_MAINNET=yes; make it again with that set if you (the owner) mean to send real transactions');
    }
    if (plan.cluster !== 'mainnet' && plan.allowMainnet !== undefined) err('allowMainnet is set on a plan that is not mainnet');
    if (typeof plan.rpcUrl !== 'string' || !/^https:\/\/[^\s]+$/.test(plan.rpcUrl)) err('the plan has no https RPC address');
    if (!isPubkey(plan.signer)) err('the plan does not name the account that must sign');
    else out.signer = plan.signer;
    if (!Array.isArray(plan.steps) || !plan.steps.length) { err('the plan has no steps'); return out; }

    var sawInitialize = false;
    plan.steps.forEach(function (step, si) {
      var n = si + 1;
      var s = { title: String((step && step.title) || 'Step ' + n), instructions: [], managerSigned: false, initialize: null, pools: [] };
      var list = step && Array.isArray(step.instructions) ? step.instructions : [];
      if (!list.length) err('step ' + n + ' has no instructions');
      list.forEach(function (ix, ii) {
        var where = 'step ' + n + ', instruction ' + (ii + 1);
        if (!ix || typeof ix !== 'object' || !isPubkey(ix.programId)) { err(where + ': no program address'); return; }
        var d = describeInstruction(ix, plan.cluster);
        d.label = typeof ix.label === 'string' ? ix.label : '';
        d.problems.forEach(function (p) { err(where + (d.name ? ' (' + d.name + ')' : '') + ': ' + p); });
        d.accounts.forEach(function (a) {
          if (a.isSigner && out.signer && a.pubkey !== out.signer) {
            err(where + ': needs a signature from ' + a.pubkey + ' (' + a.role + '), which is not the account this plan is for');
          }
        });
        if (d.decoded) {
          if (d.managerSigned) s.managerSigned = true;
          if (d.name === 'Initialize') {
            s.initialize = { pool: d.accounts[0].pubkey, manager: d.accounts[1].pubkey, staker: d.accounts[2].pubkey, managerFeeAccount: d.accounts[7].pubkey };
          }
          if (s.pools.indexOf(d.accounts[0].pubkey) < 0) s.pools.push(d.accounts[0].pubkey);
        }
        s.instructions.push(d);
      });
      // Initialize goes alone and first: nothing else may ride with it, and nothing may come before it.
      if (s.initialize) {
        if (s.instructions.length !== 1) err('step ' + n + ': Initialize must be alone in its transaction');
        if (si !== 0 || sawInitialize) err('step ' + n + ': Initialize must be the first step');
        sawInitialize = true;
      }
      if (s.pools.length > 1) err('step ' + n + ' touches more than one stake pool');
      out.steps.push(s);
    });

    out.ok = out.errors.length === 0;
    return out;
  }

  /** The part of a StakePool account this page checks (state.rs struct StakePool, first 226 bytes). */
  function readPoolHead(data) {
    if (!data || data.length < 226) return { accountType: data && data.length ? data[0] : -1 };
    var key = function (o) { return b58encode(data.subarray(o, o + 32)); };
    return {
      accountType: data[0], // 0 uninitialized, 1 stake pool, 2 validator list
      manager: key(1), staker: key(33), stakeDepositAuthority: key(65),
      validatorList: key(98), reserveStake: key(130), poolMint: key(162), managerFeeAccount: key(194),
    };
  }

  /** Short fingerprint of the plan file's exact bytes: the Mac prints it, the phone shows it, a person compares. */
  function fingerprint(sha256Bytes) {
    var hex = bytesToHex(sha256Bytes).slice(0, 16).toUpperCase();
    return hex.replace(/(.{4})(?=.)/g, '$1 ');
  }

  var api = {
    FORMAT: FORMAT, CLUSTERS: CLUSTERS, WELL_KNOWN: WELL_KNOWN, STAKE_POOL_IX: STAKE_POOL_IX,
    b58encode: b58encode, b58decode: b58decode, isPubkey: isPubkey, hexToBytes: hexToBytes, bytesToHex: bytesToHex,
    b64urlEncode: b64urlEncode, b64urlDecode: b64urlDecode, utf8Decode: utf8Decode,
    feeText: feeText, amount9: amount9, describeInstruction: describeInstruction, checkPlan: checkPlan,
    readPoolHead: readPoolHead, fingerprint: fingerprint,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PoolPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
