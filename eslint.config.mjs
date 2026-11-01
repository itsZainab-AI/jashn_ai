import js from '@eslint/js';

const nodeGlobals = {
  AbortSignal: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  __dirname: 'readonly',
  console: 'readonly',
  exports: 'writable',
  fetch: 'readonly',
  global: 'readonly',
  module: 'writable',
  process: 'readonly',
  require: 'readonly',
  setImmediate: 'readonly',
  setTimeout: 'readonly',
};

const browserGlobals = {
  AbortSignal: 'readonly',
  FormData: 'readonly',
  Headers: 'readonly',
  IntersectionObserver: 'readonly',
  Intl: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  history: 'readonly',
  localStorage: 'readonly',
  location: 'readonly',
  matchMedia: 'readonly',
  navigator: 'readonly',
  requestAnimationFrame: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  window: 'readonly',
};

export default [
  {
    ignores: ['data/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['server.js', 'src/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-control-regex': 'off',
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...browserGlobals,
        console: 'readonly',
        matchMedia: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern:
            '^(loadDashboard|render|renderVenues|renderGuests|renderReplies|showRsvpPage|print_|submitAuth|readList|saveList|steps|inr|step|currentUser|el|fetchWithAuth|setUser|createGuestRoster|queueProgressSave|burst|renderPlanOverview|renderBudget|renderTimeline|renderChecklist|renderIdeas|renderActions)$',
        },
      ],
    },
  },
];
