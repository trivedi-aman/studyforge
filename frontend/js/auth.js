// ============================================================
// AUTH SCREEN
// ============================================================

import { Auth } from './api.js';
import { state, set } from './state.js';
import { toast } from './toast.js';

export function renderAuthScreen(root, onAuthed) {
  let mode = 'signin';

  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-screen__form-side">
        <div class="auth-card">
          <div class="auth-card__brand">
            <div class="auth-card__brand-mark">S</div>
            <div class="auth-card__brand-name">Studyforge</div>
          </div>
          <h1 class="auth-card__heading" id="auth-heading">Welcome back</h1>
          <p class="auth-card__sub" id="auth-sub">Sign in to get back to your folders, notes, and documents.</p>

          <div class="auth-form__error" id="auth-error"></div>

          <form class="auth-form" id="auth-form">
            <div class="field">
              <label class="field__label" for="auth-email">Email</label>
              <input class="input" id="auth-email" type="email" placeholder="you@example.com" required autocomplete="email" />
            </div>
            <div class="field">
              <label class="field__label" for="auth-password">Password</label>
              <input class="input" id="auth-password" type="password" placeholder="••••••••" required autocomplete="current-password" minlength="6" />
            </div>
            <button class="btn btn--primary btn--block" type="submit" id="auth-submit" style="height:40px; margin-top:4px;">Sign in</button>
          </form>

          <div class="auth-form__switch">
            <span id="auth-switch-text">Don't have an account?</span>
            <button id="auth-switch-btn" type="button">Create one</button>
          </div>
        </div>
      </div>

      <div class="auth-screen__visual-side">
        <div class="auth-visual">
          <div class="auth-visual__eyebrow">/ Agentic Multi-Modal Content Transformation Pipeline</div>
          <h2 class="auth-visual__headline">One place to read, write, and <em>think</em> alongside your documents.</h2>
          <p class="auth-visual__desc">Folders that just work, a proper document viewer with search and annotation, and AI that's only ever a click away — never running until you ask it to.</p>
          <div class="auth-visual__stack">
            <span class="auth-visual__chip">RAG chat</span>
            <span class="auth-visual__chip">YouTube → Notes</span>
            <span class="auth-visual__chip">Text → PPT</span>
            <span class="auth-visual__chip">PPT → Notes</span>
            <span class="auth-visual__chip">Versioned</span>
            <span class="auth-visual__chip">Annotated</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const heading = root.querySelector('#auth-heading');
  const sub = root.querySelector('#auth-sub');
  const switchText = root.querySelector('#auth-switch-text');
  const switchBtn = root.querySelector('#auth-switch-btn');
  const submitBtn = root.querySelector('#auth-submit');
  const errorBox = root.querySelector('#auth-error');
  const form = root.querySelector('#auth-form');

  function applyMode() {
    if (mode === 'signin') {
      heading.textContent = 'Welcome back';
      sub.textContent = 'Sign in to get back to your folders, notes, and documents.';
      submitBtn.textContent = 'Sign in';
      switchText.textContent = "Don't have an account?";
      switchBtn.textContent = 'Create one';
    } else {
      heading.textContent = 'Create your account';
      sub.textContent = 'Set up your workspace — folders, documents, and AI tools, all in one place.';
      submitBtn.textContent = 'Create account';
      switchText.textContent = 'Already have an account?';
      switchBtn.textContent = 'Sign in instead';
    }
    errorBox.classList.remove('show');
  }

  switchBtn.addEventListener('click', () => {
    mode = mode === 'signin' ? 'signup' : 'signin';
    applyMode();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = root.querySelector('#auth-email').value.trim();
    const password = root.querySelector('#auth-password').value;
    submitBtn.disabled = true;
    submitBtn.textContent = mode === 'signin' ? 'Signing in…' : 'Creating account…';
    errorBox.classList.remove('show');
    try {
      const result = mode === 'signin' ? await Auth.signIn(email, password) : await Auth.signUp(email, password);
      set({ user: result.user }, ['user']);
      toast(mode === 'signin' ? `Welcome back, ${result.user.name || result.user.email}.` : 'Account created — welcome to Studyforge.', 'success');
      onAuthed();
    } catch (err) {
      errorBox.textContent = err.message || 'Something went wrong. Try again.';
      errorBox.classList.add('show');
    } finally {
      submitBtn.disabled = false;
      applyMode();
    }
  });

  applyMode();
}
