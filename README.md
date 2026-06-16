# AgentPhone DevTools

AgentPhone DevTools is a local simulator, inspector, and lightweight eval loop for developers building on [AgentPhone](https://agentphone.ai). It exists to make AgentPhone agents easier to build without placing real calls, sending real texts, spending money, or hurting number reputation while debugging.

## Quickstart

```bash
npm install
npm run build
npm --workspace examples/handler-express start
npx agentphone-devtools --target http://localhost:3000/webhook --secret whsec_demo --scenario examples/scenarios/ev-support.yaml
```

The CLI starts the simulator backend and inspector UI together. The scenario runs entirely on your machine against your webhook handler.

## Fidelity

The simulator signs the exact raw JSON bytes it sends using AgentPhone's documented webhook algorithm:

```text
sha256 = HMAC_SHA256(webhook_secret, `${timestamp}.${rawBody}`)
```

Tests cover the signer against the published verifier shape, and the generated SMS, voice, and call-ended payloads match the documented AgentPhone webhook contract.

## Cost

The default path uses no AgentPhone account, no real phone number, no carrier traffic, and no paid model call. Optional model-judge eval is disabled unless you explicitly configure a provider key.

## License

MIT.
