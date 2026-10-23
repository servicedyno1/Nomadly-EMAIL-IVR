/* global process */
const axios = require('axios')
require('dotenv').config()

const baseUrl = process.env.DYNO_PAY_BASE_URL
const apiKey = process.env.DYNO_PAY_API_KEY

// DynoPay auth = the `x-api-key` header ALONE (per https://dynopay.com/documentation
// › Authentication: "Your API key is all you need … no token exchange"). The old
// `Authorization: Bearer <DYNO_PAY_WALLET_TOKEN>` was an OPTIONAL per-customer token;
// sending a stale/expired/malformed one made DynoPay reject the whole request (401).
const headers = {
  accept: 'application/json',
  'content-type': 'application/json',
  'x-api-key': apiKey,
}

// Hardcoded supported currencies (the /getSupportedCurrency endpoint no longer exists)
const SUPPORTED_CRYPTO = [
  { currency: 'BTC', name: 'Bitcoin' },
  { currency: 'ETH', name: 'Ethereum' },
  { currency: 'LTC', name: 'Litecoin' },
  { currency: 'DOGE', name: 'Dogecoin' },
  { currency: 'USDT-TRC20', name: 'USDT (TRC20)' },
  { currency: 'USDT-ERC20', name: 'USDT (ERC20)' },
  { currency: 'BCH', name: 'Bitcoin Cash' },
  { currency: 'TRX', name: 'TRON' },
]

// keyOverride: optional DynoPay API key (CloudIVR web uses its own key).
const getDynopayCryptoAddress = async (amount, currency, webhook_url, meta_data, keyOverride) => {
  // Enforce minimum $1 USD as required by DynoPay
  const finalAmount = Math.max(amount, 1)

  const options = {
    method: 'POST',
    url: `${baseUrl}/user/cryptoPayment`,
    headers: keyOverride ? { ...headers, 'x-api-key': keyOverride } : headers,
    data: {
      amount: finalAmount,
      currency,
      redirect_uri: webhook_url,
      webhook_url: webhook_url,
      meta_data
    },
  }
  
  try {
    const response = await axios.request(options)
    return response?.data?.data
  } catch (error) {
    console.error('Error in getting Crypto address', error?.message)
    return { error: error?.message }
  }
}

const getDynopayCryptoPaymentStatus = async (address) => {
  const options = {
    method: 'GET',
    url: `${baseUrl}/user/getCryptoTransaction/${address}`,
    headers: headers
  }

  try {
    const response = await axios.request(options)
    return response.data.data
  } catch (error) {
    console.error('Error in Fetching Crypto Currency', error?.response?.data?.message)
    return false
  }
}

// Authoritative status by immutable payment_id (DynoPay "Verify Payment by ID —
// recommended"): keyed on the payment_id, returns the DB-authoritative status +
// amount, and stays correct after the checkout session/address expires. This is
// the reliable replacement for getCryptoTransaction/:address, which is
// intermittently "Application not found" for storefront payment addresses.
const getDynopayPaymentStatusById = async (paymentId) => {
  if (!paymentId) return false
  const options = {
    method: 'GET',
    url: `${baseUrl}/user/getPaymentStatus/${paymentId}`,
    headers: headers,
  }
  try {
    const response = await axios.request(options)
    return response?.data?.data || response?.data || false
  } catch (error) {
    console.error('Error fetching DynoPay payment status by id', error?.response?.data?.message || error?.message)
    return false
  }
}

module.exports = { getDynopayCryptoAddress, getDynopayCryptoPaymentStatus, getDynopayPaymentStatusById }
