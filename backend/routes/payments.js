const crypto = require('crypto');
const express = require('express');

const ZENO_URL = 'https://zenoapi.com/api/payments/mobile_money_tanzania';

/**
 * @param {import('pg').Pool} pool
 */
module.exports = function createPaymentsRouter(pool) {
  const router = express.Router();

  /**
   * POST /api/payments/create-payment
   * Mount: app.use('/api/payments', createPaymentsRouter(pool))
   */
  router.post('/create-payment', async (req, res) => {
    console.log('HIT CREATE PAYMENT ROUTE');
    try {
      const { phone, plan_id, amount, device_id, device_fingerprint, buyer_name, buyer_email } =
        req.body || {};
      console.log('create-payment payload:', {
        phone,
        plan_id,
        amount,
        device_id,
        device_fingerprint: device_fingerprint ? '[set]' : undefined,
      });

      if (!phone || plan_id == null || plan_id === '' || amount == null || !device_id || !device_fingerprint) {
        return res.status(400).json({
          error: 'Missing required fields: phone, plan_id, amount, device_id, device_fingerprint',
        });
      }

      const apiKey = process.env.ZENO_API_KEY;
      const accountId = process.env.ZENO_ACCOUNT_ID;
      const webhookUrl = process.env.ZENO_WEBHOOK_URL;

      if (!apiKey || !accountId || !webhookUrl) {
        console.error('Missing env: ZENO_API_KEY, ZENO_ACCOUNT_ID, or ZENO_WEBHOOK_URL');
        return res.status(500).json({
          error: 'Server missing ZenoPay configuration (ZENO_API_KEY, ZENO_ACCOUNT_ID, ZENO_WEBHOOK_URL)',
        });
      }

      const order_id = crypto.randomUUID();
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
      }

      await pool.query(
        `INSERT INTO payment_transactions (order_id, phone, plan_id, amount, device_id, device_fingerprint, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
        [order_id, String(phone), String(plan_id), amt, String(device_id), String(device_fingerprint)],
      );

      const zenopayBody = {
        order_id,
        buyer_name: buyer_name && String(buyer_name).trim() ? String(buyer_name).trim() : 'Osmani TV',
        buyer_phone: String(phone).trim(),
        buyer_email:
          buyer_email && String(buyer_email).trim()
            ? String(buyer_email).trim()
            : `payments+${order_id.slice(0, 8)}@customer.osmani.local`,
        amount: amt,
        account_id: String(accountId).trim(),
        webhook_url: String(webhookUrl).trim(),
      };

      console.log('CALLING ZENOPAY');

      let zenopayRes;
      let zenopayText;
      try {
        zenopayRes = await fetch(ZENO_URL, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(zenopayBody),
        });
        zenopayText = await zenopayRes.text();
      } catch (fetchErr) {
        console.error('ZenoPay fetch error:', fetchErr);
        await pool.query(
          `UPDATE payment_transactions
           SET status = 'ZENOPAY_NETWORK_ERROR', zenopay_response = $1::jsonb
           WHERE order_id = $2`,
          [JSON.stringify({ error: String(fetchErr.message || fetchErr) }), order_id],
        );
        return res.status(502).json({
          error: 'ZenoPay request failed',
          order_id,
          details: String(fetchErr.message || fetchErr),
        });
      }

      let data;
      try {
        data = zenopayText ? JSON.parse(zenopayText) : {};
      } catch {
        data = { raw: zenopayText };
      }

      console.log('ZENOPAY RESPONSE', data);

      const statusAfter = zenopayRes.ok ? 'STK_SENT' : 'ZENOPAY_ERROR';
      await pool.query(
        `UPDATE payment_transactions
         SET status = $1, zenopay_response = $2::jsonb
         WHERE order_id = $3`,
        [statusAfter, JSON.stringify({ httpStatus: zenopayRes.status, body: data }), order_id],
      );

      if (!zenopayRes.ok) {
        return res.status(zenopayRes.status >= 400 ? zenopayRes.status : 502).json({
          order_id,
          error: data?.message || data?.error || 'ZenoPay returned an error',
          zenopay: data,
        });
      }

      const expiresInSeconds = Number(data?.expires_in_seconds ?? data?.expiresIn ?? data?.timeout_seconds);
      return res.status(200).json({
        order_id,
        ...(Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? { expires_in_seconds: expiresInSeconds } : {}),
        ...data,
      });
    } catch (err) {
      console.error('create-payment error:', err);
      return res.status(500).json({ error: err?.message || 'create-payment failed' });
    }
  });

  return router;
};
