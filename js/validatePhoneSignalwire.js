/* global process */
require('dotenv').config()
const axios = require('axios')
const TOKEN_SIGNALWIRE = process.env.TOKEN_SIGNALWIRE
const MULTITEL_USERNAME = process.env.MULTITEL_USERNAME
const MULTITEL_PASSWORD = process.env.MULTITEL_PASSWORD

const cnamViaSignalwire = async phone => {
  const config = {
    method: 'get',
    url: `https://greetline-llc.signalwire.com/api/relay/rest/lookup/phone_number/%2B${phone}?include=carrier,cnam`,
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${TOKEN_SIGNALWIRE}`,
    },
    timeout: 8000,
  }

  const res = await axios(config)
  return res?.data?.cnam?.caller_id || 'None'
}

const cnamViaMultitel = async phone => {
  const res = await axios({
    method: 'get',
    url: `https://api.multitel.net/v3/cnam/${phone}`,
    httpsAgent: require('./multitel').ipv4,
    auth: { username: MULTITEL_USERNAME, password: MULTITEL_PASSWORD },
    timeout: 8000,
  })

  if (res?.data?.status?.code !== 200) {
    throw new Error(res?.data?.status?.msg || 'Multitel lookup failed')
  }
  return res?.data?.response?.name || 'None'
}

const validatePhoneSignalwire = async phone => {
  // Primary: Multitel
  try {
    return await cnamViaMultitel(phone)
  } catch (e) {
    console.log(`[CNAM] Multitel failed for ${phone}: ${e?.message}`)
  }

  // Backup: SignalWire
  try {
    const name = await cnamViaSignalwire(phone)
    console.log(`[CNAM] SignalWire backup used for ${phone}`)
    return name
  } catch (e) {
    console.log(`[CNAM] SignalWire also failed for ${phone}: ${e?.message}`)
  }

  return 'Not Found'
}

module.exports = validatePhoneSignalwire
