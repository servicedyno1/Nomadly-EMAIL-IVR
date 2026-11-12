// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Translation Service for Support Messages
// Provides bi-directional translation between admin (English) and users
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const { log } = require('console')

// Supported languages
const SUPPORTED_LANGUAGES = {
  en: { name: 'English', nativeName: 'English' },
  fr: { name: 'French', nativeName: 'Français' },
  es: { name: 'Spanish', nativeName: 'Español' },
  de: { name: 'German', nativeName: 'Deutsch' },
  it: { name: 'Italian', nativeName: 'Italiano' },
  pt: { name: 'Portuguese', nativeName: 'Português' },
  zh: { name: 'Chinese', nativeName: '中文' },
  hi: { name: 'Hindi', nativeName: 'हिन्दी' },
  ar: { name: 'Arabic', nativeName: 'العربية' },
  ru: { name: 'Russian', nativeName: 'Русский' },
  tr: { name: 'Turkish', nativeName: 'Türkçe' },
  ja: { name: 'Japanese', nativeName: '日本語' },
  ko: { name: 'Korean', nativeName: '한국어' },
}

/**
 * Detect language of text using OpenAI
 * @param {string} text - Text to detect language
 * @returns {Promise<string>} - Language code (e.g., 'en', 'fr', 'zh')
 */
async function detectLanguage(text) {
  if (!text || text.trim().length < 3) return 'en'
  
  // Quick detection for common patterns
  const hasArabic = /[\u0600-\u06FF]/.test(text)
  const hasChinese = /[\u4E00-\u9FFF]/.test(text)
  const hasHindi = /[\u0900-\u097F]/.test(text)
  const hasRussian = /[\u0400-\u04FF]/.test(text)
  
  if (hasArabic) return 'ar'
  if (hasChinese) return 'zh'
  if (hasHindi) return 'hi'
  if (hasRussian) return 'ru'
  
  // Use OpenAI for other languages
  let OpenAI = null
  try { OpenAI = require('openai') } catch { return 'en' }
  if (!OpenAI || !process.env.APP_OPEN_API_KEY) return 'en'
  
  try {
    const ai = new OpenAI({ apiKey: process.env.APP_OPEN_API_KEY })
    const res = await ai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { 
          role: 'system', 
          content: `Detect the language of the following text and return ONLY the ISO 639-1 code (e.g., en, fr, es, de, it, pt, zh, hi, ar, ru, tr, ja, ko). Return 'en' if uncertain.`
        },
        { role: 'user', content: text },
      ],
      max_tokens: 5,
      temperature: 0,
    })
    
    const detected = res.choices?.[0]?.message?.content?.trim()?.toLowerCase() || 'en'
    // Validate it's a known code
    return SUPPORTED_LANGUAGES[detected] ? detected : 'en'
  } catch (e) {
    log(`[Translation] Language detection error: ${e.message}`)
    return 'en'
  }
}

/**
 * Translate text from source language to target language
 * @param {string} text - Text to translate
 * @param {string} targetLang - Target language code (e.g., 'fr', 'en')
 * @param {string} sourceLang - Source language code (optional, will auto-detect)
 * @returns {Promise<string>} - Translated text
 */
async function translateText(text, targetLang, sourceLang = null) {
  if (!text || text.trim().length === 0) return text
  
  // Auto-detect source language if not provided
  if (!sourceLang) {
    sourceLang = await detectLanguage(text)
  }
  
  // No translation needed if same language
  if (sourceLang === targetLang) return text
  
  const targetLangName = SUPPORTED_LANGUAGES[targetLang]?.name || targetLang
  const sourceLangName = SUPPORTED_LANGUAGES[sourceLang]?.name || sourceLang
  
  let OpenAI = null
  try { OpenAI = require('openai') } catch { return text }
  if (!OpenAI || !process.env.APP_OPEN_API_KEY) return text
  
  try {
    const ai = new OpenAI({ apiKey: process.env.APP_OPEN_API_KEY })
    const res = await ai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { 
          role: 'system', 
          content: `You are a professional translator. Translate the following text from ${sourceLangName} to ${targetLangName}. Maintain the tone, formatting, and context. If the text contains technical terms or product names, keep them as-is. Return ONLY the translated text.`
        },
        { role: 'user', content: text },
      ],
      max_tokens: 1000,
      temperature: 0.3,
    })
    
    const translated = res.choices?.[0]?.message?.content?.trim() || text
    log(`[Translation] ${sourceLang} → ${targetLang}: ${text.substring(0, 50)}... → ${translated.substring(0, 50)}...`)
    return translated
  } catch (e) {
    log(`[Translation] Error: ${e.message}`)
    return text
  }
}

/**
 * Translate user message to English for admin
 * @param {string} text - User's message
 * @param {string} userLang - User's language code (optional, will auto-detect if null)
 * @returns {Promise<{original: string, translated: string, detectedLang: string}>}
 */
async function translateUserMessageForAdmin(text, userLang) {
  // Always auto-detect the actual language of the message
  // Don't trust stored user language - user might type in different language
  const detectedLang = await detectLanguage(text)
  
  if (detectedLang === 'en') {
    return {
      original: text,
      translated: text,
      detectedLang: 'en',
      needsTranslation: false
    }
  }
  
  const translated = await translateText(text, 'en', detectedLang)
  const langName = SUPPORTED_LANGUAGES[detectedLang]?.nativeName || detectedLang
  
  return {
    original: text,
    translated,
    detectedLang,
    needsTranslation: true,
    langName
  }
}

/**
 * Translate admin reply to user's language
 * @param {string} text - Admin's message (assumed to be in English)
 * @param {string} userLang - User's language code
 * @returns {Promise<{original: string, translated: string}>}
 */
async function translateAdminReplyForUser(text, userLang) {
  if (!userLang || userLang === 'en') {
    return {
      original: text,
      translated: text,
      needsTranslation: false
    }
  }
  
  const translated = await translateText(text, userLang, 'en')
  
  return {
    original: text,
    translated,
    needsTranslation: true,
    targetLang: userLang,
    langName: SUPPORTED_LANGUAGES[userLang]?.nativeName || userLang
  }
}

module.exports = {
  detectLanguage,
  translateText,
  translateUserMessageForAdmin,
  translateAdminReplyForUser,
  SUPPORTED_LANGUAGES
}
