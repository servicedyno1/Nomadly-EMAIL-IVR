'use strict'
// Seed 12 natural, human-sounding approved reviews into phoneReviews (the call-test page).
// phoneReviews is not brand-scoped, so run this once per brand against that brand's DB:
//   MONGO_URL=... DB_NAME=<brand db> node scripts/seed_phone_reviews.js
// Idempotent: skips reviews whose exact comment already exists. Spreads createdAt over the last ~8 weeks.
const { MongoClient } = require('mongodb')

const REVIEWS = [
  { stars: 5, name: 'Marcus T.', comment: 'Tested it from my laptop and the call connected in a couple of seconds. Voice was crystal clear both ways, honestly better than my desk phone.' },
  { stars: 5, name: 'Priya S.', comment: 'Was skeptical a browser call would sound good but it really does. No app to install, just clicked and it worked. Very impressed.' },
  { stars: 4, name: 'Dan W.', comment: 'Worked great on the first try. Took me a second to allow the microphone but after that it was smooth. Would like a mute button but otherwise solid.' },
  { stars: 5, name: 'Aisha K.', comment: 'Did the free test call during my lunch break. Audio quality was spot on and there was basically no delay. Easy to set up for my small shop.' },
  { stars: 5, name: 'Robert Nguyen', comment: 'I run a two-person office and this let us take calls straight from the computer. The test call convinced me, no echo, no dropouts.' },
  { stars: 4, name: 'Lena', comment: 'Pretty seamless. Called my own cell to try it and it rang through right away. Clear enough that my partner could hear everything fine.' },
  { stars: 5, name: 'Carlos M.', comment: 'Set this up for our clinic reception. The test was painless and the keypad options worked exactly like they said. Staff picked it up in minutes.' },
  { stars: 5, name: 'Emily R.', comment: 'The sound is genuinely good. I tested it on wifi and then on my phone hotspot and both held up. No weird robotic voice like other services.' },
  { stars: 4, name: 'Tomasz', comment: 'Did a quick test and it just worked, no fuss. Connection was stable the whole call. Nice that I did not have to download anything.' },
  { stars: 5, name: 'Grace O.', comment: 'Honestly the easiest call test I have done. Clicked once, allowed the mic, and I was talking. Clear audio and it felt instant.' },
  { stars: 5, name: 'Sam P.', comment: 'Tried it expecting it to be clunky and it was the opposite. Smooth connection, natural sounding voice, and the whole thing took under a minute.' },
  { stars: 4, name: 'Hannah', comment: 'Good experience overall. The test call came through clearly and I could hear the menu options perfectly. Setup was straightforward for a non-techie like me.' },
]

;(async () => {
  const url = process.env.MONGO_URL
  const dbName = process.env.DB_NAME
  if (!url || !dbName) { console.error('Set MONGO_URL and DB_NAME'); process.exit(1) }
  const client = await MongoClient.connect(url)
  const col = client.db(dbName).collection('phoneReviews')
  const now = Date.now()
  let added = 0
  for (let i = 0; i < REVIEWS.length; i++) {
    const r = REVIEWS[i]
    if (await col.findOne({ comment: r.comment })) continue
    await col.insertOne({
      stars: r.stars,
      comment: r.comment,
      name: r.name,
      status: 'approved',
      seeded: true,
      createdAt: new Date(now - (i * 4 + 1 + Math.floor(Math.random() * 3)) * 86400000),
    })
    added++
  }
  console.log(`[seed_phone_reviews] ${dbName}: added ${added}, total now ${await col.countDocuments({ status: { $nin: ['pending', 'rejected'] } })}`)
  await client.close()
})().catch(e => { console.error(e); process.exit(1) })
