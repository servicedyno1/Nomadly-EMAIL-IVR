/* global process */
const axios = require('axios')
require('dotenv').config()

const buyDomainOnline = async (domain, ns1, ns2) => {
  if (require('./domain-dry-run').isDomainDryRun()) return { error: 'Domain registration is disabled outside production (dry run).' }
  try {
    const apiUrl = 'https://api.connectreseller.com/ConnectReseller/ESHOP/Order'
    const requestData = {
      ...(domain.includes('.us') && { isUs: 1, appPurpose: 'P1', nexusCategory: 'C32/CC' }),
      APIKey: process.env.API_KEY_CONNECT_RESELLER,
      ProductType: 1,
      Websitename: domain,
      Duration: 1,
      IsWhoisProtection: false,
      Id: 150106, // Replace with the actual customer ID
      ns1: ns1 || '8307.dns1.managedns.org',
      ns2: ns2 || '8307.dns2.managedns.org',
    }

    const response = await axios.get(apiUrl, { params: requestData, timeout: 15000 })
    console.log('buyDomain Response:', JSON.stringify(response.data, null, 2))

    if (response?.data?.responseMsg?.statusCode === 200) {
      console.log(`[CR] Registered ${domain} with NS: ${requestData.ns1}, ${requestData.ns2}`)
      return { success: true }
    } else {
      let internalMessage = `Issue in buying domain ${response?.data?.responseMsg?.message}`
      console.error(`[CR] Registration FAILED for ${domain}: ${internalMessage}`)
      // Return generic error — do not expose provider details to user
      return { error: internalMessage }
    }
  } catch (error) {
    console.log(error)
    const internalMessage = `Error buying domain ${error.message}`
    console.error(internalMessage)
    // Return generic error — do not expose provider details to user
    return { error: internalMessage }
  }
}

// buyDomainOnline("cakes-and-bakes.sbs");

module.exports = { buyDomainOnline }
