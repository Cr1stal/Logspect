<template>
  <div class="welcome-screen">
    <div class="welcome-content">
      <div class="welcome-icon">🚀</div>
      <h2>Welcome to Logspect</h2>
      <p>Select a Rails project directory to start monitoring logs</p>
      <div class="welcome-features">
        <div class="feature-item">
          <span class="feature-icon">📁</span>
          <span>Automatically detects Rails projects by checking for Gemfile</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">📊</span>
          <span>Real-time log monitoring with request grouping</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">🔍</span>
          <span>Smart HTTP method and path extraction</span>
        </div>
        <div class="feature-item">
          <span class="feature-icon">⚡</span>
          <span>Developer console-style interface</span>
        </div>
      </div>
      <button class="welcome-btn" @click="$emit('select-project')">
        📁 Select Rails Project Directory
      </button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'WelcomeScreen',
  emits: ['select-project']
}
</script>

<style scoped>
@reference "../style.css";
.welcome-screen {
  @apply flex-1 flex items-center justify-center bg-slate-900;
}

.welcome-content {
  @apply text-center max-w-lg p-10;
}

.welcome-content h2 {
  @apply text-slate-200 text-2xl mb-3 font-semibold;
}

.welcome-content p {
  @apply text-slate-400 text-sm mb-8 leading-relaxed;
}

.welcome-icon {
  @apply text-6xl mb-5;
}

.welcome-features {
  @apply text-left mb-8;
}

.feature-item {
  @apply flex items-center gap-3 mb-3 text-slate-300 text-xs;
}

.feature-icon {
  @apply text-base w-5 text-center;
}

.welcome-btn {
  @apply bg-sky-600 border border-sky-500 text-white px-6 py-3 rounded-md cursor-pointer text-xs font-medium transition-all duration-200 hover:bg-sky-700 hover:border-sky-600 hover:-translate-y-px;
}
</style>