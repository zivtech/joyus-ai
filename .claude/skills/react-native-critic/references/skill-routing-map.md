# React Native Critic Skill Routing Map

Core (always loaded):
- vercel-labs/agent-skills/vercel-react-native-skills — core cross-platform patterns and native rendering guidance

RN specialists (load one based on context):
- callstackincubator/agent-skills/react-native-best-practices — when reviewing RN performance or native module usage
- callstackincubator/agent-skills/upgrading-react-native — when reviewing RN version upgrades or native dependency alignment
- react-native-community/skills/upgrade-react-native — when reviewing community RN upgrade patterns and tooling
- wshobson/agents/react-native-architecture — when reviewing RN app architecture or module boundaries
- wshobson/agents/react-native-design — when reviewing RN UI/UX patterns or cross-platform styling
- callstack/react-native-testing-library/react-native-testing — when reviewing RN test implementations or native module mocking

Expo specialists (load one when Expo detected):
- expo/skills/building-native-ui — when reviewing Expo native UI components or platform APIs
- expo/skills/native-data-fetching — when reviewing Expo data fetching, caching, or offline patterns
- expo/skills/upgrading-expo — when reviewing Expo SDK version upgrades
- expo/skills/expo-api-routes — when reviewing Expo API routes or server functions
- expo/skills/expo-cicd-workflows — when reviewing Expo CI/CD pipelines or release automation
- expo/skills/use-dom — when reviewing Expo DOM components or web-native bridging

Platform integrations (load when specific SDK detected):
- getsentry/sentry-agent-skills/sentry-react-native-setup — when Sentry imports detected
- auth0/agent-skills/auth0-react-native — when Auth0 imports detected

Shared support (load one):
- wshobson/agents/javascript-testing-patterns — when reviewing test strategy or coverage gaps
- wshobson/agents/modern-javascript-patterns — when reviewing modern JS idioms and async patterns
- sickn33/antigravity-awesome-skills/api-security-best-practices — when code handles API boundaries or sensitive data

Rules:
- Load max 3 skills: 1 core + 1 RN/Expo specialist + 1 shared support.
