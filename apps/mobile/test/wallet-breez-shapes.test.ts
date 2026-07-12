/**
 * REGRESSION (native wallet, iOS 1.5.x): the RN (uniffi) Breez SDK needs
 * UniffiEnum class instances (PascalCase `tag`, positional `inner`); plain
 * WASM-style {type: '…'} objects throw UnexpectedEnumCase — shown to users as
 * "Raw enum value doesn't match any cases" on the Receive Bitcoin/Spark tabs.
 */
import { describe, it, expect } from 'vitest';
import {
  bitcoinAddressMethod, bolt11ReceiveMethod, bolt11SendOptions, inputPaymentRequest,
  paymentFailed, sparkAddressMethod, sparkInvoiceMethod, variantDetails, variantOf,
} from '../src/wallet/breezShapes';

// Minimal stand-in for the generated uniffi enum namespaces: class instances
// carrying `tag` + frozen `inner`, like uniffi-bindgen-react-native emits.
const variant = (typeName: string, tag: string) => class {
  tag = tag;
  inner: unknown[];
  _t = typeName;
  constructor(...args: unknown[]) { this.inner = Object.freeze(args) as unknown[]; }
};
const M = {
  ReceivePaymentMethod: {
    SparkAddress: variant('ReceivePaymentMethod', 'SparkAddress'),
    SparkInvoice: variant('ReceivePaymentMethod', 'SparkInvoice'),
    BitcoinAddress: variant('ReceivePaymentMethod', 'BitcoinAddress'),
    Bolt11Invoice: variant('ReceivePaymentMethod', 'Bolt11Invoice'),
  },
  PaymentRequest: { Input: variant('PaymentRequest', 'Input') },
  SendPaymentOptions: { Bolt11Invoice: variant('SendPaymentOptions', 'Bolt11Invoice') },
};

describe('web (WASM) keeps plain serde objects', () => {
  it('receive methods', () => {
    expect(bolt11ReceiveMethod(null, 123.4, 'hi')).toEqual({ type: 'bolt11Invoice', description: 'hi', amountSats: 123, expirySecs: 3600 });
    expect(sparkAddressMethod(null)).toEqual({ type: 'sparkAddress' });
    expect(bitcoinAddressMethod(null)).toEqual({ type: 'bitcoinAddress' });
    expect(sparkInvoiceMethod(null, 'usdt', 1_500_000n, 'm')).toEqual({ type: 'sparkInvoice', tokenIdentifier: 'usdt', amount: '1500000', description: 'm' });
  });
  it('send request + options', () => {
    expect(inputPaymentRequest(null, 'lnbc1…')).toEqual({ type: 'input', input: 'lnbc1…' });
    expect(bolt11SendOptions(null)).toEqual({ type: 'bolt11Invoice', preferSpark: false, completionTimeoutSecs: 30 });
  });
});

describe('native (uniffi) constructs enum class instances', () => {
  it('bolt11 receive: instance with PascalCase tag and BigInt sats', () => {
    const m: any = bolt11ReceiveMethod(M, 500, 'desc');
    expect(m).toBeInstanceOf(M.ReceivePaymentMethod.Bolt11Invoice);
    expect(m.tag).toBe('Bolt11Invoice');
    expect(m.inner[0]).toMatchObject({ description: 'desc', amountSats: 500n, expirySecs: 3600 });
  });
  it('spark/bitcoin/token receive methods', () => {
    expect((sparkAddressMethod(M) as any).tag).toBe('SparkAddress');
    const btc: any = bitcoinAddressMethod(M);
    expect(btc.tag).toBe('BitcoinAddress');
    const tok: any = sparkInvoiceMethod(M, 'usdt', 1_500_000n, 'm');
    expect(tok.tag).toBe('SparkInvoice');
    expect(tok.inner[0]).toMatchObject({ tokenIdentifier: 'usdt', amount: 1_500_000n }); // BigInt, NOT string
  });
  it('send request + bolt11 options', () => {
    const req: any = inputPaymentRequest(M, 'user@freeport.network');
    expect(req.tag).toBe('Input');
    expect(req.inner[0]).toEqual({ input: 'user@freeport.network' });
    const opt: any = bolt11SendOptions(M);
    expect(opt.tag).toBe('Bolt11Invoice');
    expect(opt.inner[0]).toEqual({ preferSpark: false, completionTimeoutSecs: 30 });
  });
});

describe('result normalization across dialects', () => {
  it('paymentFailed: WASM string and native numeric enum (Failed=2)', () => {
    expect(paymentFailed('failed')).toBe(true);
    expect(paymentFailed(2)).toBe(true);
    expect(paymentFailed('completed')).toBe(false);
    expect(paymentFailed(0)).toBe(false);
    expect(paymentFailed(undefined)).toBe(false);
  });
  it('variantOf lowercases both dialects', () => {
    expect(variantOf({ type: 'bolt11Invoice' })).toBe('bolt11invoice');
    expect(variantOf({ tag: 'Bolt11Invoice', inner: [{}] })).toBe('bolt11invoice');
    expect(variantOf(undefined)).toBe('');
  });
  it('variantDetails: inline on WASM, inner[0] on native', () => {
    expect(variantDetails({ type: 'bolt11Invoice', amountMsat: 5000 }).amountMsat).toBe(5000);
    expect(variantDetails({ tag: 'Bolt11Invoice', inner: [{ amountMsat: 5000 }] }).amountMsat).toBe(5000);
  });
});
