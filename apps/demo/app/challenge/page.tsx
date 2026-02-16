import { generateChallengeToken } from './actions';
import { ChallengeForm } from './challenge-form';

function generateProblem() {
  const ops = ['+', '-', '*'] as const;
  const op = ops[Math.floor(Math.random() * ops.length)];

  let a: number, b: number, answer: number;

  switch (op) {
    case '+':
      a = Math.floor(Math.random() * 50) + 1;
      b = Math.floor(Math.random() * 50) + 1;
      answer = a + b;
      break;
    case '-':
      a = Math.floor(Math.random() * 50) + 10;
      b = Math.floor(Math.random() * a);
      answer = a - b;
      break;
    case '*':
      a = Math.floor(Math.random() * 12) + 2;
      b = Math.floor(Math.random() * 12) + 2;
      answer = a * b;
      break;
  }

  return { question: `${a} ${op} ${b}`, answer };
}

export default async function ChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { question, answer } = generateProblem();
  const token = generateChallengeToken(answer);

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Dataqueue Demo
        </h1>
        <p className="text-sm text-muted-foreground">
          Solve this quick challenge to access the demo.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-4">
          <div className="text-center">
            <p className="mb-1 text-sm font-medium text-muted-foreground">
              What is
            </p>
            <p className="font-mono text-3xl font-bold tracking-wider">
              {question}
            </p>
          </div>

          <ChallengeForm token={token} error={error} />
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        This challenge helps prevent automated abuse.
      </p>
    </div>
  );
}
