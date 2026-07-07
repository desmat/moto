import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    rules: {
      "react/no-unescaped-entities": "off",
      // eslint-plugin-react-hooks v6 (bundled by eslint-config-next 16) added a React
      // Compiler-safety preset (purity/refs/immutability/set-state-in-effect) that flags
      // ordinary, safe patterns -- one-time init effects, ref access in effects, etc. --
      // as incompatible with the (opt-in, unused-here) React Compiler. This app has no
      // babel-plugin-react-compiler configured, so these rules just add noise across both
      // app code and vendored shadcn/ui primitives; off until the compiler is adopted.
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
