import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

// ESLint 9 flat config. `next lint` was removed in Next 16, so linting runs via
// the ESLint CLI (`npm run lint` → `eslint .`). eslint-config-next 16 ships
// native flat-config arrays, imported directly (no FlatCompat).
//
// We extend only `next/core-web-vitals` — matching the pre-16 `.eslintrc.json`
// scope. (Adding `next/typescript` would newly enforce a stricter ruleset that
// is out of scope for a framework bump.)
const eslintConfig = [
  {
    ignores: ['.next/**', 'coverage/**', 'node_modules/**', 'next-env.d.ts'],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      // Enforce the typed OpenAPI client — no raw fetch to our API. This is a
      // CI/pre-commit gate, not a convention: `eslint .` fails on a raw fetch.
      // The sole sanctioned external fetch (presigned upload) is exempted below.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message:
            "Don't call the API with raw fetch(). Use the typed `apiClient` from '@/lib/api' (generated from openapi/openapi.yaml) so requests/responses are typed and covered by the OpenAPI no-drift check. If an endpoint is missing, add it to the spec and run `task openapi:gen`. The only sanctioned raw fetch is the external presigned upload in hooks/useImageUpload.ts.",
        },
        {
          selector:
            "MemberExpression[object.name=/^(window|globalThis|self)$/][property.name='fetch']",
          message:
            "Don't call the API with raw fetch(). Use the typed `apiClient` from '@/lib/api'. See hooks/useImageUpload.ts for the one sanctioned external-upload exception.",
        },
      ],
    },
  },
  {
    rules: {
      // eslint-plugin-react-hooks v6 (bundled by eslint-config-next 16) ships
      // the React Compiler readiness rules at error level. We don't run the
      // compiler yet, and these flag pre-existing, working patterns (prop→state
      // resync effects, Next's `params.then(setState)`, manual memoization).
      // Keep them as warnings so they're visible follow-ups without turning a
      // framework bump into a refactor of ~12 call sites.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  {
    // The one sanctioned raw fetch: the external presigned PUT to MinIO/S3.
    files: ['src/hooks/useImageUpload.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
]

export default eslintConfig
