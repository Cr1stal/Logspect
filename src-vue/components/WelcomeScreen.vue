<template>
  <div class="welcome-screen">
    <div class="welcome-content">
      <div class="welcome-icon">🚀</div>
      <h2>Welcome to LogMan</h2>
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
.welcome-screen {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1e1e1e;
}

.welcome-content {
  text-align: center;
  max-width: 500px;
  padding: 40px;
}

.welcome-content h2 {
  color: #cccccc;
  font-size: 24px;
  margin-bottom: 12px;
  font-weight: 600;
}

.welcome-content p {
  color: #9ca3af;
  font-size: 14px;
  margin-bottom: 32px;
  line-height: 1.5;
}

.welcome-icon {
  font-size: 64px;
  margin-bottom: 20px;
}

.welcome-features {
  text-align: left;
  margin-bottom: 32px;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  color: #d4d4d4;
  font-size: 13px;
}

.feature-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
}

.welcome-btn {
  background: #0e639c;
  border: 1px solid #007acc;
  color: white;
  padding: 12px 24px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
}

.welcome-btn:hover {
  background: #094771;
  border-color: #005a9e;
  transform: translateY(-1px);
}
</style>