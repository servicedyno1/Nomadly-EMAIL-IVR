/* global process */
// Real domain orders/renewals only happen on production. Preview/dev/tests always get a simulated result.
const isDomainDryRun = () => process.env.DOMAIN_DRY_RUN === 'true' || process.env.BOT_ENVIRONMENT !== 'production'

const DRY_RUN_NS = ['ns1.dry-run.invalid', 'ns2.dry-run.invalid']

module.exports = { isDomainDryRun, DRY_RUN_NS }
