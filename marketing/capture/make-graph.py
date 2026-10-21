"""Makes the extracted local graph the demo PR: acme/payments #482, its description, and the threads on its lines.
usage: make-graph.py <extracted.json> <out.json>"""
import json, sys
from datetime import datetime, timedelta, timezone
ago = lambda m: (datetime.now(timezone.utc) - timedelta(minutes=m)).strftime('%Y-%m-%dT%H:%M:%SZ')
src, dst = sys.argv[1:3]
g = json.load(open(src))
g['pr'].update(provider='github', owner='acme', repo='payments', number=482, url='https://github.com/acme/payments/pull/482',
  title='Retry failed charges safely', author='maya',
  body='Failed charges are retried up to three times with backoff. Every attempt carries the same idempotency key, so the processor charges at most once.\n\n- `withRetry` in policy.ts: 3 tries, 200ms → 800ms\n- the worker mints the key once and keeps it on `payment.retryKey`\n- the retry endpoint queues a job instead of charging inline\n\nCloses #476')
for k in ('branch', 'baseRef'): g['pr'].pop(k, None)
u = 'https://github.com/acme/payments/pull/482#discussion_r'
g['discussion'] = [
 dict(id='901', path='src/payments/retry.ts', line=8, side='RIGHT', author='jon', body="Could this make a new key on every retry? If a caller mints one per call we're back to double charges.", url=u+'901', createdAt=ago(50)),
 dict(id='902', path='src/payments/retry.ts', line=8, side='RIGHT', author='maya', body="The worker keeps it on `payment.retryKey`, so it's minted once per payment.", url=u+'902', createdAt=ago(38), replyTo='901'),
 dict(id='903', path='src/payments/policy.ts', line=11, side='RIGHT', author='lina', body='Name the parameter `policy`, not `opts`?', url=u+'903', createdAt=ago(140), resolved=True),
 dict(id='904', path='src/payments/policy.ts', line=11, side='RIGHT', author='maya', body='Done.', url=u+'904', createdAt=ago(120), replyTo='903', resolved=True),
 dict(id='905', path='src/billing/invoice.ts', line=7, side='RIGHT', author='lina', body='Do fees belong in this PR?', url=u+'905', createdAt=ago(138)),
]
json.dump(g, open(dst, 'w'), indent=1)
