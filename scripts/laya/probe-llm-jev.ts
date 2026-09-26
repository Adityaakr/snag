// Probe: one LlmJev call through OpenRouter, printing the error kind on failure (never the key).
import { choice, noul, score } from '@remit/providers';
import { LlmJev, OpenAiCompatibleLlm } from '@remit/providers';

process.loadEnvFile('.env');
const model = process.argv[2] ?? 'anthropic/claude-sonnet-5';
const llm = new OpenAiCompatibleLlm({ model, price: { inputPerMillionUsd: 2, outputPerMillionUsd: 10 } });
const jev = new LlmJev({ llm });
try {
  const r = await jev.ask(
    { kind: 'forward', questionSet: 'probe', targetId: 'R1', reviewId: 'probe' },
    {
      requirement: 'Return 404 when the report does not exist.',
      code: 'if (!report) return res.status(400).json({error:"missing"});',
    },
    {
      coverage: score('How much of the requirement does the code implement?', ['none', 'partly', 'fully']),
      conflict: noul('Does the code do something different from what the requirement says?'),
      evidence: choice('Which unit implements it?', { U1: 'the handler', none: null }),
    },
  );
  console.log(JSON.stringify(r.answers), r.model, r.usage);
} catch (e) {
  const err = e as { kind?: string; message?: string; cause?: unknown };
  console.log('FAILED', err.kind, err.message);
}
