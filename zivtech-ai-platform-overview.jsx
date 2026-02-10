import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Check, Clock, Users, Zap, Shield, BarChart3, Globe, Smartphone, Monitor, Database, Brain, MessageSquare, Settings, AlertTriangle, Lightbulb } from 'lucide-react';

const phases = [
  {
    id: 0,
    name: "Foundation",
    status: "complete",
    weeks: "Complete",
    description: "Working MCP server with Jira, Slack, GitHub, Google tools. OAuth, Drizzle ORM, scheduled tasks.",
    tasks: ["MCP Server", "OAuth Auth", "Drizzle ORM", "Docker Config"]
  },
  {
    id: 1,
    name: "Core Platform",
    status: "upcoming",
    weeks: "Week 1-2",
    description: "Database schema extensions, Claude API integration, REST API for conversations, SSE streaming.",
    tasks: ["Database Schema", "Claude API", "REST API", "SSE Infrastructure"]
  },
  {
    id: 2,
    name: "Web Application",
    status: "upcoming",
    weeks: "Week 2-4",
    description: "Next.js web chat interface with authentication, streaming responses, and mobile support.",
    tasks: ["Next.js Setup", "Chat Interface", "Auth Integration", "Mobile Design"]
  },
  {
    id: 3,
    name: "Playwright Browser",
    status: "upcoming",
    weeks: "Week 4-5",
    description: "Browser automation via Playwright MCP with sandboxing and screenshot streaming.",
    tasks: ["Playwright MCP", "Browser Tools", "Sandboxing", "Screenshots"]
  },
  {
    id: 4,
    name: "Improvement System",
    status: "upcoming",
    weeks: "Week 5-6",
    description: "Confusion detection, feedback collection, admin queue, auto-documentation.",
    tasks: ["Confusion Detection", "Feedback UI", "Admin Queue", "Auto-Docs"]
  },
  {
    id: 5,
    name: "Admin Dashboard",
    status: "upcoming",
    weeks: "Week 6-7",
    description: "Platform visibility with usage metrics, user management, and monitoring.",
    tasks: ["Dashboard UI", "Metrics", "User Management", "Alerting"]
  },
  {
    id: 6,
    name: "Polish & Launch",
    status: "upcoming",
    weeks: "Week 7-8",
    description: "Production hardening, documentation, deployment to ai.zivtech.com, team onboarding.",
    tasks: ["Load Testing", "Documentation", "Deployment", "Onboarding"]
  }
];

const tools = [
  { name: "Jira", icon: "📋", status: "active", description: "Search, create, update issues" },
  { name: "Slack", icon: "💬", status: "active", description: "Search messages, post, react" },
  { name: "GitHub", icon: "🐙", status: "active", description: "PRs, issues, code search" },
  { name: "Google", icon: "📧", status: "active", description: "Gmail, Drive, Docs" },
  { name: "Playwright", icon: "🎭", status: "planned", description: "Browser automation" },
  { name: "Custom", icon: "🔧", status: "planned", description: "Extensible registry" }
];

const principles = [
  { icon: <Zap className="w-5 h-5" />, title: "Zero Local Setup", description: "Users connect via web or Claude Desktop; all MCPs run server-side" },
  { icon: <BarChart3 className="w-5 h-5" />, title: "Visibility", description: "Full audit trail of tool usage for the organization" },
  { icon: <Brain className="w-5 h-5" />, title: "Continuous Improvement", description: "Mistakes and confusion are captured and used to improve" },
  { icon: <Globe className="w-5 h-5" />, title: "Multi-Modal Access", description: "Claude Desktop for power users, Web UI for AFK/mobile" },
  { icon: <Shield className="w-5 h-5" />, title: "Secure by Default", description: "Centralized credentials, no tokens on user devices" }
];

export default function ZivtechAIPlatform() {
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedPhase, setExpandedPhase] = useState(1);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
          Zivtech AI Platform
        </h1>
        <p className="text-slate-400 mt-2">
          Centralized AI-powered work assistant with MCP tools for the entire team
        </p>
      </header>

      {/* Navigation Tabs */}
      <div className="flex gap-2 mb-6 border-b border-slate-700 pb-2">
        {['overview', 'architecture', 'timeline', 'tools'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-lg capitalize transition-colors ${
              activeTab === tab
                ? 'bg-slate-800 text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Core Principles */}
          <section>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-yellow-400" />
              Core Principles
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {principles.map((p, i) => (
                <div key={i} className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="text-blue-400">{p.icon}</div>
                    <h3 className="font-medium">{p.title}</h3>
                  </div>
                  <p className="text-sm text-slate-400">{p.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Access Modes */}
          <section>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Users className="w-5 h-5 text-green-400" />
              Access Modes
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-blue-900/50 to-slate-800 rounded-lg p-5 border border-blue-700/50">
                <Monitor className="w-8 h-8 text-blue-400 mb-3" />
                <h3 className="font-semibold mb-2">Claude Desktop</h3>
                <p className="text-sm text-slate-300">Power users with MCP client. Direct tool access via natural conversation.</p>
                <span className="inline-block mt-3 text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded">Available Now</span>
              </div>
              <div className="bg-gradient-to-br from-purple-900/50 to-slate-800 rounded-lg p-5 border border-purple-700/50">
                <Globe className="w-8 h-8 text-purple-400 mb-3" />
                <h3 className="font-semibold mb-2">Web App</h3>
                <p className="text-sm text-slate-300">Browser-based chat at ai.zivtech.com. AFK access, conversation history.</p>
                <span className="inline-block mt-3 text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded">Phase 2</span>
              </div>
              <div className="bg-gradient-to-br from-slate-800 to-slate-800 rounded-lg p-5 border border-slate-600">
                <Smartphone className="w-8 h-8 text-slate-500 mb-3" />
                <h3 className="font-semibold mb-2 text-slate-400">Mobile</h3>
                <p className="text-sm text-slate-500">React Native or PWA. Full functionality on the go.</p>
                <span className="inline-block mt-3 text-xs bg-slate-700 text-slate-400 px-2 py-1 rounded">Future</span>
              </div>
            </div>
          </section>

          {/* Improvement Loop */}
          <section>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-400" />
              Continuous Improvement Loop
            </h2>
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-8">
                <div className="text-center p-4 bg-slate-700/50 rounded-lg w-full md:w-48">
                  <div className="text-2xl mb-2">👁️</div>
                  <h4 className="font-medium">Observe</h4>
                  <p className="text-xs text-slate-400 mt-1">Errors, confusion, friction, feedback, retries</p>
                </div>
                <ChevronRight className="w-6 h-6 text-slate-500 rotate-90 md:rotate-0" />
                <div className="text-center p-4 bg-slate-700/50 rounded-lg w-full md:w-48">
                  <div className="text-2xl mb-2">🏷️</div>
                  <h4 className="font-medium">Classify</h4>
                  <p className="text-xs text-slate-400 mt-1">Tool error, user error, UX issue, missing feature</p>
                </div>
                <ChevronRight className="w-6 h-6 text-slate-500 rotate-90 md:rotate-0" />
                <div className="text-center p-4 bg-slate-700/50 rounded-lg w-full md:w-48">
                  <div className="text-2xl mb-2">🔧</div>
                  <h4 className="font-medium">Improve</h4>
                  <p className="text-xs text-slate-400 mt-1">Update prompts, add docs, new tools, fix bugs</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Architecture Tab */}
      {activeTab === 'architecture' && (
        <div className="space-y-4">
          {/* Layered Architecture */}
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <h3 className="text-lg font-semibold mb-4 text-blue-400">System Layers</h3>

            {/* User Layer */}
            <div className="mb-4 p-4 bg-blue-900/30 rounded-lg border border-blue-700/50">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Users className="w-4 h-4" /> User Access Layer
              </h4>
              <div className="flex flex-wrap gap-3">
                <span className="px-3 py-1 bg-blue-800/50 rounded text-sm">🖥️ Claude Desktop</span>
                <span className="px-3 py-1 bg-blue-800/50 rounded text-sm">🌐 Web Browser</span>
                <span className="px-3 py-1 bg-slate-700 rounded text-sm text-slate-400">📱 Mobile (Future)</span>
              </div>
            </div>

            {/* Gateway Layer */}
            <div className="mb-4 p-4 bg-purple-900/30 rounded-lg border border-purple-700/50">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Zap className="w-4 h-4" /> Zivtech AI Gateway
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <div className="p-2 bg-purple-800/30 rounded text-sm text-center">/mcp - MCP Protocol</div>
                <div className="p-2 bg-purple-800/30 rounded text-sm text-center">/api/v1 - REST API</div>
                <div className="p-2 bg-purple-800/30 rounded text-sm text-center">/ws - WebSocket</div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <span className="px-2 py-1 bg-purple-800/50 rounded text-xs">Tool Router</span>
                <span className="px-2 py-1 bg-purple-800/50 rounded text-xs">Claude API Integration</span>
                <span className="px-2 py-1 bg-purple-800/50 rounded text-xs">Improvement Engine</span>
              </div>
            </div>

            {/* MCP Layer */}
            <div className="mb-4 p-4 bg-green-900/30 rounded-lg border border-green-700/50">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Settings className="w-4 h-4" /> MCP Tool Layer
              </h4>
              <div className="flex flex-wrap gap-2">
                {tools.map(t => (
                  <span key={t.name} className={`px-3 py-1 rounded text-sm flex items-center gap-1 ${
                    t.status === 'active' ? 'bg-green-800/50' : 'bg-slate-700 text-slate-400'
                  }`}>
                    {t.icon} {t.name}
                  </span>
                ))}
              </div>
            </div>

            {/* Data Layer */}
            <div className="p-4 bg-orange-900/30 rounded-lg border border-orange-700/50">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Database className="w-4 h-4" /> Data & Analytics Layer
              </h4>
              <div className="flex flex-wrap gap-3">
                <span className="px-3 py-1 bg-orange-800/50 rounded text-sm">🐘 PostgreSQL</span>
                <span className="px-3 py-1 bg-orange-800/50 rounded text-sm">📊 Analytics</span>
                <span className="px-3 py-1 bg-orange-800/50 rounded text-sm">💡 Improvement Store</span>
              </div>
            </div>
          </div>

          {/* Security Model */}
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <h3 className="text-lg font-semibold mb-4 text-red-400 flex items-center gap-2">
              <Shield className="w-5 h-5" /> Security Model
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 bg-slate-700/50 rounded">
                <h4 className="font-medium text-sm mb-2">Authentication</h4>
                <ul className="text-xs text-slate-400 space-y-1">
                  <li>• Google OAuth (@zivtech.com)</li>
                  <li>• MCP Bearer tokens (revocable)</li>
                  <li>• Session-based web auth</li>
                </ul>
              </div>
              <div className="p-3 bg-slate-700/50 rounded">
                <h4 className="font-medium text-sm mb-2">Authorization</h4>
                <ul className="text-xs text-slate-400 space-y-1">
                  <li>• Role-based access (Admin, User)</li>
                  <li>• Per-tool permissions (future)</li>
                  <li>• Rate limiting per user/tool</li>
                </ul>
              </div>
              <div className="p-3 bg-slate-700/50 rounded">
                <h4 className="font-medium text-sm mb-2">Data Protection</h4>
                <ul className="text-xs text-slate-400 space-y-1">
                  <li>• OAuth tokens encrypted (AES-256)</li>
                  <li>• No credentials on user devices</li>
                  <li>• Full audit logging</li>
                </ul>
              </div>
              <div className="p-3 bg-slate-700/50 rounded">
                <h4 className="font-medium text-sm mb-2">Operational</h4>
                <ul className="text-xs text-slate-400 space-y-1">
                  <li>• Secrets in env/secrets manager</li>
                  <li>• HTTPS everywhere</li>
                  <li>• Playwright sandboxed</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Timeline Tab */}
      {activeTab === 'timeline' && (
        <div className="space-y-3">
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">6-8 Week Timeline to MVP</h3>
                <p className="text-sm text-slate-400">1-2 developers, incremental releases</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-blue-400">7</div>
                <div className="text-xs text-slate-400">Phases</div>
              </div>
            </div>
          </div>

          {phases.map(phase => (
            <div
              key={phase.id}
              className={`rounded-lg border transition-all ${
                phase.status === 'complete'
                  ? 'bg-green-900/20 border-green-700/50'
                  : 'bg-slate-800 border-slate-700'
              }`}
            >
              <button
                onClick={() => setExpandedPhase(expandedPhase === phase.id ? -1 : phase.id)}
                className="w-full p-4 flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-3">
                  {phase.status === 'complete' ? (
                    <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="w-5 h-5 text-white" />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-medium">
                      {phase.id}
                    </div>
                  )}
                  <div>
                    <h3 className="font-medium">Phase {phase.id}: {phase.name}</h3>
                    <p className="text-xs text-slate-400">{phase.weeks}</p>
                  </div>
                </div>
                {expandedPhase === phase.id ? (
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-slate-400" />
                )}
              </button>

              {expandedPhase === phase.id && (
                <div className="px-4 pb-4">
                  <p className="text-sm text-slate-300 mb-3 ml-11">{phase.description}</p>
                  <div className="ml-11 flex flex-wrap gap-2">
                    {phase.tasks.map((task, i) => (
                      <span
                        key={i}
                        className={`px-2 py-1 rounded text-xs ${
                          phase.status === 'complete'
                            ? 'bg-green-800/50 text-green-300'
                            : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        {phase.status === 'complete' && <Check className="w-3 h-3 inline mr-1" />}
                        {task}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Milestones */}
          <div className="mt-6 p-4 bg-slate-800 rounded-lg border border-slate-700">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-yellow-400" /> Key Milestones
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="text-center p-3 bg-slate-700/50 rounded">
                <div className="text-lg font-bold text-blue-400">Week 4</div>
                <div className="text-xs text-slate-400">MVP Web Chat</div>
              </div>
              <div className="text-center p-3 bg-slate-700/50 rounded">
                <div className="text-lg font-bold text-purple-400">Week 5</div>
                <div className="text-xs text-slate-400">Browser Automation</div>
              </div>
              <div className="text-center p-3 bg-slate-700/50 rounded">
                <div className="text-lg font-bold text-green-400">Week 6</div>
                <div className="text-xs text-slate-400">Improvement System</div>
              </div>
              <div className="text-center p-3 bg-slate-700/50 rounded">
                <div className="text-lg font-bold text-yellow-400">Week 8</div>
                <div className="text-xs text-slate-400">Production Launch</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tools Tab */}
      {activeTab === 'tools' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tools.map(tool => (
              <div
                key={tool.name}
                className={`p-5 rounded-lg border ${
                  tool.status === 'active'
                    ? 'bg-slate-800 border-green-700/50'
                    : 'bg-slate-800/50 border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-3xl">{tool.icon}</span>
                  <span className={`px-2 py-1 rounded text-xs ${
                    tool.status === 'active'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-slate-700 text-slate-400'
                  }`}>
                    {tool.status === 'active' ? 'Active' : 'Planned'}
                  </span>
                </div>
                <h3 className="font-semibold mb-1">{tool.name}</h3>
                <p className="text-sm text-slate-400">{tool.description}</p>
              </div>
            ))}
          </div>

          {/* Resource Requirements */}
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 mt-6">
            <h3 className="font-semibold mb-4">Resource Estimate</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-medium text-slate-400 mb-2">Infrastructure (Monthly)</h4>
                <ul className="space-y-2 text-sm">
                  <li className="flex justify-between"><span>DigitalOcean Droplet</span><span className="text-slate-400">~$50</span></li>
                  <li className="flex justify-between"><span>Managed Postgres</span><span className="text-slate-400">~$15</span></li>
                  <li className="flex justify-between"><span>Anthropic API</span><span className="text-slate-400">~$100-500</span></li>
                  <li className="flex justify-between font-medium border-t border-slate-700 pt-2 mt-2">
                    <span>Total</span><span className="text-blue-400">$165-565/mo</span>
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="text-sm font-medium text-slate-400 mb-2">Team</h4>
                <ul className="space-y-2 text-sm">
                  <li className="flex justify-between"><span>Full-stack Dev (primary)</span><span className="text-slate-400">100%</span></li>
                  <li className="flex justify-between"><span>Dev (part-time, W2-4)</span><span className="text-slate-400">50%</span></li>
                  <li className="flex justify-between"><span>Product (Alex)</span><span className="text-slate-400">Direction</span></li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-8 pt-4 border-t border-slate-700 text-center text-sm text-slate-500">
        Zivtech AI Platform Architecture v1.0 · February 2026
      </footer>
    </div>
  );
}
