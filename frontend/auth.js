const authDialog = document.getElementById("sign-in");
const openAuthButton = document.querySelector("[data-open-auth]");
const closeAuthButton = document.querySelector("[data-close-auth]");

openAuthButton?.addEventListener("click", () => {
  if (authDialog && !authDialog.open) authDialog.showModal();
});

closeAuthButton?.addEventListener("click", () => authDialog?.close());

authDialog?.addEventListener("click", (event) => {
  if (event.target === authDialog) authDialog.close();
});

if (window.location.hash === "#sign-in" && authDialog) {
  authDialog.showModal();
}



const form = document.getElementById('login-form');
const message = document.getElementById('auth-message');
const signedInBox = document.getElementById('signed-in');
const signedInEmail = document.getElementById('signed-in-email');
const logoutBtn = document.getElementById('logout-btn');
const formButtons = form.querySelectorAll('button');

function show(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? 'crimson' : 'inherit';
}

// swap between the form and the "signed in" box
function render(session) {
  const loggedIn = !!session && !session.user.is_anonymous;
  form.style.display = loggedIn ? 'none' : '';
  signedInBox.style.display = loggedIn ? 'block' : 'none';
  if (loggedIn) signedInEmail.textContent = session.user.email;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const action = e.submitter?.value;           // "signin" or "signup"
  const email = form.email.value.trim();
  const password = form.password.value;

  show('Working...');
  formButtons.forEach(b => (b.disabled = true));   // prevent double clicks

  try {
    if (action === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) return show(error.message, true);
      // no session means "Confirm email" is still on in Supabase
      if (!data.session) return show('Check your email to confirm your account.');
      window.location.href = 'dashboard.html';
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return show(error.message, true);
      window.location.href = 'dashboard.html';
    }
  } catch (err) {
    show('Could not reach the server. Check your connection.', true);
    console.error(err);
  } finally {
    formButtons.forEach(b => (b.disabled = false));
  }
});

logoutBtn.addEventListener('click', async () => {
  await sb.auth.signOut();
  show('');
});

// fires on page load (restoring any saved session) and on every login/logout
sb.auth.onAuthStateChange((_event, session) => render(session));
