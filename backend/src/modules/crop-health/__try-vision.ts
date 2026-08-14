/** Temporary manual check of the Ollama vision path. Delete after use. */
import fs from 'node:fs';
import { analyseCropImage } from './vision';
import { diagnose, buildWeatherContext } from './diagnosis';
import { resolveCrop } from '../../domain/crops';

async function run(file: string, description: string, language: string) {
  const base64 = fs.readFileSync(file).toString('base64');
  const { crop, isKnown } = resolveCrop('tomato');

  const startedAt = Date.now();
  const external = await analyseCropImage(base64, {
    language,
    latitude: 26.85,
    longitude: 80.95,
    cropLabel: crop.label,
    knownProblems: [...crop.diseases.map((d) => d.name), ...crop.pests.map((p) => p.name)],
    description,
    observedAt: new Date(),
  });

  console.log(`\n===== ${file} (${language}) — ${Date.now() - startedAt} ms =====`);
  console.log(JSON.stringify(external, null, 2));

  const diagnosis = diagnose({
    crop,
    cropIsKnown: isKnown,
    description,
    weather: buildWeatherContext([]),
    hasImage: true,
    external,
  });

  console.log('----- diagnosis -----');
  console.log(
    JSON.stringify(
      {
        summary: diagnosis.summary,
        severity: diagnosis.severity,
        confidence: diagnosis.confidence,
        method: diagnosis.method,
        image: diagnosis.image,
        candidates: diagnosis.candidates.map((c) => ({
          name: c.name,
          kind: c.kind,
          confidence: c.confidence,
          severity: c.severity,
          source: c.source,
          evidence: c.evidence,
          signals: c.signals,
        })),
        nextSteps: diagnosis.nextSteps,
      },
      null,
      2,
    ),
  );
}

const [file, description = '', language = 'en'] = process.argv.slice(2);
run(file, description, language).catch((err) => {
  console.error(err);
  process.exit(1);
});
