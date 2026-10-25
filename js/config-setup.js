// Configuration setup for the application
// This file loads environment variables and sets up basic configuration

// Load <cwd>/.env first, then backend/.env (no root .env symlink — a gitignored
// root .env breaks the platform's `git add -A ':(exclude).env'` staging step).
const path = require('path');
require('dotenv').config({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(__dirname, '../backend/.env')],
});

console.log('🔧 Loading configuration...');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENVIRONMENT DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Detects the current environment (development or production)
 * 
 * Priority order:
 * 1. BOT_ENVIRONMENT (manually set by user: 'development' or 'production')
 * 2. REPLIT_DEPLOYMENT (set by Replit when deployed)
 * 3. NODE_ENV (standard Node.js environment variable)
 * 
 * @returns {string} 'development' or 'production'
 */
function detectEnvironment() {
  const envVars = process.env;
  
  // User-defined environment (highest priority)
  if (envVars.BOT_ENVIRONMENT) {
    const userEnv = envVars.BOT_ENVIRONMENT.toLowerCase();
    if (userEnv === 'development' || userEnv === 'production') {
      return userEnv;
    }
  }
  
  // Check if running in Replit deployment
  if (envVars.REPLIT_DEPLOYMENT === '1' || envVars.REPLIT_DEPLOYMENT === 'true') {
    return 'production';
  }
  
  // Check NODE_ENV
  if (envVars.NODE_ENV === 'production') {
    return 'production';
  }
  
  // Default to development for safety
  return 'development';
}

/**
 * Gets the appropriate bot token based on environment
 * 
 * Token priority:
 * - Production: TELEGRAM_BOT_TOKEN_PROD → TELEGRAM_BOT_TOKEN
 * - Development: TELEGRAM_BOT_TOKEN_DEV → TELEGRAM_BOT_TOKEN
 * 
 * @param {string} environment - 'development' or 'production'
 * @returns {string|undefined} Bot token or undefined if not found
 */
function getBotToken(environment) {
  const envVars = process.env;
  
  if (environment === 'production') {
    // Try production-specific token first, fall back to general token
    return envVars.TELEGRAM_BOT_TOKEN_PROD || envVars.TELEGRAM_BOT_TOKEN;
  } else {
    // Try development-specific token first, fall back to general token
    return envVars.TELEGRAM_BOT_TOKEN_DEV || envVars.TELEGRAM_BOT_TOKEN;
  }
}

// Detect environment and select appropriate token
const CURRENT_ENVIRONMENT = detectEnvironment();
const BOT_TOKEN_TO_USE = getBotToken(CURRENT_ENVIRONMENT);

// Override TELEGRAM_BOT_TOKEN with environment-specific token
if (BOT_TOKEN_TO_USE) {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN_TO_USE;
}

// Set environment-specific SELF_URL for webhooks
const getSelfUrl = () => {
  let url, source;
  
  if (CURRENT_ENVIRONMENT === 'production') {
    // Production: Use SELF_URL_PROD or fallback to SELF_URL
    // In Replit deployments, this should be the .replit.app domain
    if (process.env.SELF_URL_PROD) {
      url = process.env.SELF_URL_PROD;
      source = 'SELF_URL_PROD';
    } else if (process.env.SELF_URL) {
      url = process.env.SELF_URL;
      source = 'SELF_URL (fallback)';
    }
  } else {
    // Development: Use REPLIT_DEV_DOMAIN (auto-available in workspace)
    // or fallback to SELF_URL_DEV or SELF_URL
    if (process.env.REPLIT_DEV_DOMAIN) {
      url = `https://${process.env.REPLIT_DEV_DOMAIN}`;
      source = 'REPLIT_DEV_DOMAIN (auto-detected)';
    } else if (process.env.SELF_URL_DEV) {
      url = process.env.SELF_URL_DEV;
      source = 'SELF_URL_DEV';
    } else if (process.env.SELF_URL) {
      url = process.env.SELF_URL;
      source = 'SELF_URL (fallback)';
    }
  }
  
  return { url, source };
};

const { url: SELF_URL_TO_USE, source: URL_SOURCE } = getSelfUrl();
if (SELF_URL_TO_USE) {
  process.env.SELF_URL = SELF_URL_TO_USE;
  console.log(`🌐 Webhook base URL: ${SELF_URL_TO_USE}`);
  console.log(`📍 URL Source: ${URL_SOURCE}`);
  console.log(`📡 Webhook endpoint: ${SELF_URL_TO_USE}/telegram/webhook`);
}

// Log environment info (without exposing full tokens)
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🤖 BOT ENVIRONMENT CONFIGURATION');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Environment: ${CURRENT_ENVIRONMENT.toUpperCase()}`);
console.log(`Token Source: ${CURRENT_ENVIRONMENT === 'production' 
  ? (process.env.TELEGRAM_BOT_TOKEN_PROD ? 'TELEGRAM_BOT_TOKEN_PROD' : 'TELEGRAM_BOT_TOKEN (fallback)')
  : (process.env.TELEGRAM_BOT_TOKEN_DEV ? 'TELEGRAM_BOT_TOKEN_DEV' : 'TELEGRAM_BOT_TOKEN (fallback)')
}`);
console.log(`Token Configured: ${BOT_TOKEN_TO_USE ? 'YES ✅' : 'NO ❌'}`);

// Show environment detection details
const detectionDetails = [];
if (process.env.BOT_ENVIRONMENT) {
  detectionDetails.push(`BOT_ENVIRONMENT=${process.env.BOT_ENVIRONMENT}`);
}
if (process.env.REPLIT_DEPLOYMENT) {
  detectionDetails.push(`REPLIT_DEPLOYMENT=${process.env.REPLIT_DEPLOYMENT}`);
}
if (process.env.NODE_ENV) {
  detectionDetails.push(`NODE_ENV=${process.env.NODE_ENV}`);
}

if (detectionDetails.length > 0) {
  console.log(`Detection basis: ${detectionDetails.join(', ')}`);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Export environment detection functions
global.BOT_ENVIRONMENT = CURRENT_ENVIRONMENT;
global.isProduction = () => CURRENT_ENVIRONMENT === 'production';
global.isDevelopment = () => CURRENT_ENVIRONMENT === 'development';

// Set default values for missing environment variables
const setDefault = (key, value) => {
  if (!process.env[key]) {
    process.env[key] = value;
    console.log(`🔧 Setting default for ${key}: ${value}`);
  }
};

// Core application defaults
setDefault('DB_NAME', 'nomadly_bot');
setDefault('HOSTED_ON', 'railway');
setDefault('REST_APIS_ON', 'true');
// NOTE: SELF_URL must be set via environment variable - no default to avoid webhook conflicts
setDefault('CHAT_BOT_NAME', 'NomadlyBot');
setDefault('CHAT_BOT_BRAND', 'Nomadly');

// Pricing defaults
setDefault('RATE_LEAD_VALIDATOR', '20');
setDefault('RATE_LEAD', '20');
setDefault('RATE_CNAM', '15');
setDefault('RATE_CNAM_VALIDATOR', '15');
setDefault('PRICE_BITLY_LINK', '0.1');
setDefault('FREE_LINKS', '5');
setDefault('FREE_LINKS_TIME_SECONDS', '43200');

// Subscription pricing
setDefault('PRICE_DAILY_SUBSCRIPTION', '0.03');
setDefault('PRICE_WEEKLY_SUBSCRIPTION', '0.04');
setDefault('PRICE_MONTHLY_SUBSCRIPTION', '0.05');
setDefault('DAILY_PLAN_FREE_DOMAINS', '1');
setDefault('WEEKLY_PLAN_FREE_DOMAINS', '3');
setDefault('MONTHLY_PLAN_FREE_DOMAINS', '5');
setDefault('DAILY_PLAN_FREE_VALIDATIONS', '5000');
setDefault('WEEKLY_PLAN_FREE_VALIDATIONS', '10000');
setDefault('MONTHLY_PLAN_FREE_VALIDATIONS', '15000');

// Support defaults
setDefault('SUPPORT_USERNAME', '@nomadly_support');
setDefault('SUPPORT_HANDLE', '@nomadly_support');
setDefault('TG_HANDLE', '@nomadly_channel');
setDefault('TG_CHANNEL', '@nomadly_updates');

// Feature toggles
setDefault('HIDE_BANK_PAYMENT', 'false');
setDefault('HIDE_SMS_APP', 'false');
setDefault('HIDE_BECOME_RESELLER', 'false');

// SMS App config
setDefault('SMS_APP_NAME', 'NomadlySMS');
setDefault('SMS_APP_LINK', 'https://play.google.com/store');

// Domain config
setDefault('PERCENT_INCREASE_DOMAIN', '0.25');

// Hosting config
setDefault('PREMIUM_ANTIRED_WEEKLY_PRICE', '30');
setDefault('GOLDEN_ANTIRED_CPANEL_PRICE', '100');
setDefault('PREMIUM_ANTIRED_CPANEL_PRICE', '75');
setDefault('VPS_HOURLY_PLAN_MINIMUM_AMOUNT_PAYABLE', '1.00');
setDefault('HOSTING_TRIAL_PLAN_ON', 'false');
setDefault('OVERAGE_RATE_MIN', '0.15');
setDefault('OVERAGE_RATE_SMS', '0.02');
setDefault('OFFSHORE_HOSTING_ON', 'false');

// Admin config (use defaults if not set)
setDefault('TELEGRAM_ADMIN_CHAT_ID', '123456789');
setDefault('TELEGRAM_DEV_CHAT_ID', '123456789');

// Basic validation of critical environment variables
const criticalEnvVars = [
  'MONGO_URL',
  'TELEGRAM_BOT_TOKEN'
];

const missingCriticalVars = criticalEnvVars.filter(varName => !process.env[varName]);

if (missingCriticalVars.length > 0) {
  console.error('❌ Critical environment variables missing:', missingCriticalVars.join(', '));
  console.log('ℹ️  These must be set in Replit secrets for the application to work');
} else {
  console.log('✅ All critical environment variables are set');
}

console.log('✅ Configuration setup completed');
