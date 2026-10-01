/**
 * Regression: phone-config.planByButton only knew the ENGLISH plan labels, so FR/ZH/HI users
 * tapping "⭐ Pro — $75/mois" were answered "Veuillez sélectionner un forfait." forever and could
 * never buy a plan (production complaint, 2026-10-01). Every language's plan buttons must resolve.
 */
process.env.PHONE_STARTER_ON = process.env.PHONE_STARTER_ON || 'true'
process.env.PHONE_PRO_ON = process.env.PHONE_PRO_ON || 'true'
process.env.PHONE_BUSINESS_ON = process.env.PHONE_BUSINESS_ON || 'true'
const phoneConfig = require('../js/phone-config')

describe('phone-config plan buttons resolve in every language', () => {
  const langs = ['en', 'fr', 'zh', 'hi']
  test.each(langs)('%s: starter/pro/business labels map to plan keys', (lang) => {
    const b = phoneConfig.getBtn(lang)
    expect(phoneConfig.planByButton[b.starterPlan]).toBe('starter')
    expect(phoneConfig.planByButton[b.proPlan]).toBe('pro')
    expect(phoneConfig.planByButton[b.businessPlan]).toBe('business')
  })

  test('localized labels differ from English (otherwise this test would be vacuous)', () => {
    expect(phoneConfig.getBtn('fr').proPlan).not.toBe(phoneConfig.getBtn('en').proPlan)
  })

  test('unknown text still resolves to nothing', () => {
    expect(phoneConfig.planByButton['not a plan']).toBeUndefined()
  })
})
