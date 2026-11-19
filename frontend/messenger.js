const API_URL = window.location.port === '3001'
    ? 'http://127.0.0.1:8000'
    : window.location.origin;
const TOKEN_KEY = 'messenger-session-token';
const ASSISTANT_HISTORY_KEY = 'messenger-assistant-history';
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const messages = document.getElementById('messages');
const recipientSelect = document.getElementById('recipient-select');
const messageStatus = document.getElementById('message-status');
const sendButton = document.getElementById('send-button');
const authPanel = document.getElementById('auth-panel');
const app = document.getElementById('app');
const authForm = document.getElementById('auth-form');
const authName = document.getElementById('auth-name');
const authNameLabel = document.getElementById('auth-name-label');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authSubmit = document.getElementById('auth-submit');
const authTitle = document.getElementById('auth-title');
const authDescription = document.getElementById('auth-description');
const authToggle = document.getElementById('auth-toggle');
const authStatus = document.getElementById('auth-status');
const profileForm = document.getElementById('profile-form');
const passwordForm = document.getElementById('password-form');
const logoutButton = document.getElementById('logout-button');
const accountStatus = document.getElementById('account-status');
const aiStatus = document.getElementById('message-status');
let currentUser = null;
let isRegistering = false;
let refreshTimer = null;
let conversationRequestId = 0;
let assistantHistory = [];

function saveAssistantHistory() {
    try {
        sessionStorage.setItem(
            `${ASSISTANT_HISTORY_KEY}:${currentUser.id}`,
            JSON.stringify(assistantHistory),
        );
        return true;
    } catch (error) {
        console.warn('Could not save AI conversation history in this browser session.', error);
        showStatus(aiStatus, 'The conversation could not be saved in this browser session.');
        return false;
    }
}

function restoreAssistantHistory() {
    let storedHistory;
    try {
        storedHistory = sessionStorage.getItem(`${ASSISTANT_HISTORY_KEY}:${currentUser.id}`);
    } catch (error) {
        console.warn('Could not access saved AI conversation history.', error);
        showStatus(aiStatus, 'Conversation history is unavailable in this browser session.');
        return;
    }
    if (!storedHistory) return;

    try {
        const history = JSON.parse(storedHistory);
        const isValid = Array.isArray(history)
            && history.length <= 20
            && history.length % 2 === 0
            && history.every((message) => (
                message
                && ['user', 'assistant'].includes(message.role)
                && typeof message.content === 'string'
                && message.content.length > 0
                && message.content.length <= 4000
            ))
            && history.every((message, index) => (
                message.role === (index % 2 === 0 ? 'user' : 'assistant')
            ))
            && history.reduce((total, message) => total + message.content.length, 0) <= 12000;
        if (!isValid) throw new Error('Saved AI chat history has an invalid format.');

        assistantHistory = history;
        if (assistantHistory.length > 0) renderAssistantHistory();
    } catch (error) {
        console.warn('Could not restore the saved AI chat history.', error);
        try {
            sessionStorage.removeItem(`${ASSISTANT_HISTORY_KEY}:${currentUser.id}`);
        } catch (storageError) {
            console.warn('Could not remove invalid AI conversation history.', storageError);
        }
        showStatus(aiStatus, 'The saved AI conversation could not be restored and was cleared.');
    }
}

function renderAssistantHistory() {
    messages.replaceChildren();
    assistantHistory.forEach((message) => {
        const isUser = message.role === 'user';
        addMessage(isUser ? 'You' : 'Lamik AI', message.content, isUser, undefined, !isUser);
    });
    messages.scrollTop = messages.scrollHeight;
}

function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
}

function showStatus(element, text) {
    if (!element) return;
    element.textContent = text;
    element.hidden = !text;
}

async function requestJson(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    let response;
    try {
        response = await fetch(`${API_URL}${path}`, { ...options, headers });
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new Error('Could not connect to the server. Check your connection and try again.');
    }
    if (response.status === 204) {
        if (!response.ok) throw new Error('The request could not be completed.');
        return null;
    }

    let data = null;
    try {
        data = await response.json();
    } catch {
        if (response.ok) {
            throw new Error('The server returned an invalid response. Please try again.');
        }
    }

    if (!response.ok) {
        const detail = data?.detail;
        const message = Array.isArray(detail)
            ? detail.map((item) => item.msg || JSON.stringify(item)).join('; ')
            : detail || 'The request could not be completed. Please try again.';
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }
    if (response.ok && data === null) {
        throw new Error('The server returned an invalid response. Please try again.');
    }
    return data;
}

function displayAuthForm() {
    if (app) app.hidden = true;
    if (authPanel) authPanel.hidden = false;
    if (!authForm) return;
    authForm.reset();
    showStatus(authStatus, '');
    authName.hidden = !isRegistering;
    authNameLabel.hidden = !isRegistering;
    authName.required = isRegistering;
    authPassword.autocomplete = isRegistering ? 'new-password' : 'current-password';
    authPassword.minLength = isRegistering ? 10 : 1;
    authSubmit.textContent = isRegistering ? 'Create account' : 'Sign in';
    authTitle.textContent = isRegistering ? 'Create your account' : 'Sign in';
    authDescription.textContent = isRegistering
        ? 'Create an account to start messaging.'
        : 'Sign in to open your chats.';
    authToggle.textContent = isRegistering
        ? 'Already have an account? Sign in'
        : "Don't have an account? Sign up";
}

function showMessenger() {
    if (authPanel) authPanel.hidden = true;
    if (app) app.hidden = false;
    const currentUserElement = document.getElementById('current-user');
    if (currentUserElement && currentUser) {
        currentUserElement.textContent = `${currentUser.name} · ${currentUser.email}`;
    }
    if (profileForm && currentUser) {
        profileForm.elements.name.value = currentUser.name;
        profileForm.elements.email.value = currentUser.email;
    }
}

function addMessage(authorName, text, isUser, createdAt, isAIResponse = false) {
    const message = document.createElement('article');
    message.className = `chat-message${isUser ? ' from-user' : ''}`;

    const author = document.createElement('strong');
    author.textContent = authorName;
    const content = document.createElement('p');
    if (isAIResponse) {
        renderAIResponse(content, text);
    } else {
        content.textContent = text;
    }
    message.append(author, content);

    if (createdAt) {
        const time = document.createElement('time');
        time.dateTime = createdAt;
        time.textContent = new Date(createdAt).toLocaleString();
        message.append(time);
    }
    messages.append(message);
    return message;
}

function renderAIResponse(element, text) {
    const lines = text.split('\n');
    lines.forEach((line, lineIndex) => {
        const bullet = line.match(/^(\s*)\*(?=\s)/);
        if (bullet) {
            line = `${bullet[1]}•${line.slice(bullet[0].length)}`;
        }

        const formatting = /\*\*[^*\n]+?\*\*|\*[^*\n]+?\*/g;
        let previousIndex = 0;
        let match;
        while ((match = formatting.exec(line)) !== null) {
            element.append(document.createTextNode(line.slice(previousIndex, match.index)));
            const isBold = match[0].startsWith('**');
            const formatted = document.createElement(isBold ? 'strong' : 'em');
            formatted.textContent = match[0].slice(isBold ? 2 : 1, isBold ? -2 : -1);
            element.append(formatted);
            previousIndex = formatting.lastIndex;
        }
        element.append(document.createTextNode(line.slice(previousIndex)));
        if (lineIndex < lines.length - 1) {
            element.append(document.createElement('br'));
        }
    });
}

function showEmptyConversation(description) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    const title = document.createElement('h3');
    title.textContent = 'Start chatting right now';
    const details = document.createElement('p');
    details.textContent = description;
    emptyState.append(title, details);
    messages.replaceChildren(emptyState);
}

async function loadConversation() {
    if (!recipientSelect?.value) return;
    const requestId = ++conversationRequestId;
    const params = new URLSearchParams({ peer_id: recipientSelect.value });
    try {
        const history = await requestJson(`/messages/?${params}`);
        if (requestId !== conversationRequestId) return;
        messages.replaceChildren();
        if (history.length === 0) {
            showEmptyConversation('Send the first message to start this conversation.');
        } else {
            history.forEach((item) => {
                addMessage(
                    item.sender_name,
                    item.text,
                    String(item.sender_id) === String(currentUser.id),
                    item.created_at,
                );
            });
        }
        messages.scrollTop = messages.scrollHeight;
        showStatus(messageStatus, '');
    } catch (error) {
        if (requestId === conversationRequestId) {
            showStatus(messageStatus, error.message);
        }
    }
}

async function initializeMessenger() {
    if (refreshTimer) {
        window.clearInterval(refreshTimer);
        refreshTimer = null;
    }
    currentUser = await requestJson('/auth/me');
    showMessenger();
    const accounts = await requestJson('/users/');
    recipientSelect.replaceChildren();
    if (accounts.length === 0) {
        recipientSelect.disabled = true;
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No other users yet';
        recipientSelect.append(option);
        showEmptyConversation(
            'Ask another person to create an account to start a conversation.',
        );
    } else {
        recipientSelect.disabled = false;
        accounts.forEach((account) => {
            const option = document.createElement('option');
            option.value = account.id;
            option.textContent = account.name;
            recipientSelect.append(option);
        });
        await loadConversation();
        refreshTimer = window.setInterval(loadConversation, 3000);
    }

}

if (authToggle) {
    authToggle.addEventListener('click', () => {
        isRegistering = !isRegistering;
        displayAuthForm();
    });
}

if (authForm) {
    authForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        showStatus(authStatus, '');
        authSubmit.disabled = true;
        try {
            const payload = {
                email: authEmail.value.trim(),
                password: authPassword.value,
            };
            if (isRegistering) {
                payload.name = authName.value.trim();
            }
            const result = await requestJson(
                isRegistering ? '/auth/register' : '/auth/login',
                { method: 'POST', body: JSON.stringify(payload) },
            );
            sessionStorage.setItem(TOKEN_KEY, result.token);
            currentUser = result.user;
            if (messageForm) {
                await initializeMessenger();
            } else {
                window.location.href = 'messenger.html';
            }
        } catch (error) {
            showStatus(authStatus, error.message);
        } finally {
            authSubmit.disabled = false;
        }
    });
}

if (profileForm) {
    profileForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        showStatus(accountStatus, '');
        try {
            currentUser = await requestJson('/auth/me', {
                method: 'PATCH',
                body: JSON.stringify({
                    name: profileForm.elements.name.value.trim(),
                    email: profileForm.elements.email.value.trim(),
                }),
            });
            showMessenger();
            showStatus(accountStatus, 'Profile updated.');
        } catch (error) {
            showStatus(accountStatus, error.message);
        }
    });
}

if (passwordForm) {
    passwordForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        showStatus(accountStatus, '');
        const formData = new FormData(passwordForm);
        try {
            const result = await requestJson('/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({
                    current_password: formData.get('current_password'),
                    new_password: formData.get('new_password'),
                }),
            });
            sessionStorage.setItem(TOKEN_KEY, result.token);
            currentUser = result.user;
            passwordForm.reset();
            showStatus(accountStatus, 'Password changed. Other active sessions have been signed out.');
        } catch (error) {
            showStatus(accountStatus, error.message);
        }
    });
}

if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
        try {
            await requestJson('/auth/logout', { method: 'POST' });
        } catch (error) {
            showStatus(accountStatus, error.message);
        } finally {
            sessionStorage.removeItem(TOKEN_KEY);
            if (refreshTimer) window.clearInterval(refreshTimer);
            window.location.reload();
        }
    });
}

if (messageForm && messageInput && messages && recipientSelect) {
    displayAuthForm();
    initializeMessenger().catch((error) => {
        displayAuthForm();
        showStatus(authStatus, error.message);
        if (error.status === 401) {
            sessionStorage.removeItem(TOKEN_KEY);
        }
    });
    recipientSelect.addEventListener('change', loadConversation);
    messageForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = messageInput.value.trim();
        if (!text || sendButton.disabled || !recipientSelect.value) return;

        sendButton.disabled = true;
        showStatus(messageStatus, '');
        try {
            await requestJson('/messages/', {
                method: 'POST',
                body: JSON.stringify({
                    peer_id: Number(recipientSelect.value),
                    text,
                }),
            });
            messageInput.value = '';
            await loadConversation();
            messageInput.focus();
        } catch (error) {
            showStatus(messageStatus, error.message);
        } finally {
            sendButton.disabled = false;
        }
    });
} else if (!authPanel) {
    const token = getToken();
    if (!token) {
        window.location.replace('messenger.html');
    } else {
        requestJson('/auth/me').then((profile) => {
            if (!messageForm || !messageInput || !messages) return;
            currentUser = profile;
            const isCorrector = window.location.pathname.endsWith('/autocorrect.html');
            const isAIChat = window.location.pathname.endsWith('/ai-chat.html')
                || isCorrector;
            const aiMode = isCorrector ? 'corrector' : 'assistant';
            if (window.location.pathname.endsWith('/ai-chat.html')) {
                restoreAssistantHistory();
            }
            messageForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                const text = messageInput.value.trim();
                if (!text || sendButton?.disabled) return;
                const pendingMessage = addMessage(
                    isAIChat ? 'You' : currentUser.name,
                    text,
                    true,
                );
                messageInput.value = '';
                if (isAIChat) {
                    if (sendButton) sendButton.disabled = true;
                    showStatus(
                        aiStatus,
                        isCorrector ? 'Correcting your text…' : 'AI is thinking…',
                    );
                    const messagesToSend = isCorrector
                        ? [{ role: 'user', content: text }]
                        : [...assistantHistory, { role: 'user', content: text }];
                    while (
                        !isCorrector
                        && (
                            messagesToSend.length > 20
                            || messagesToSend.reduce(
                                (total, item) => total + item.content.length,
                                0,
                            ) > 12000
                        )
                    ) {
                        messagesToSend.splice(0, 2);
                    }
                    try {
                        const result = await requestJson('/ai/chat', {
                            method: 'POST',
                            body: JSON.stringify({ mode: aiMode, messages: messagesToSend }),
                        });
                        if (typeof result?.answer !== 'string' || !result.answer.trim()) {
                            throw new Error('The AI returned an invalid response. Please try again.');
                        }
                        let historySaved = true;
                        if (!isCorrector) {
                            assistantHistory = [
                                ...messagesToSend,
                                { role: 'assistant', content: result.answer },
                            ].slice(-20);
                            historySaved = saveAssistantHistory();
                            renderAssistantHistory();
                        }
                        if (isCorrector) {
                            addMessage(
                                'Russian Text Corrector',
                                result.answer,
                                false,
                                undefined,
                                true,
                            );
                        }
                        showStatus(
                            aiStatus,
                            historySaved
                                ? ''
                                : 'The response is ready, but this conversation could not be saved in this browser session.',
                        );
                    } catch (error) {
                        pendingMessage.remove();
                        if (!messageInput.value) messageInput.value = text;
                        showStatus(aiStatus, error.message);
                    } finally {
                        if (sendButton) sendButton.disabled = false;
                    }
                }
                messageInput.focus();
                messages.scrollTop = messages.scrollHeight;
            });
        }).catch((error) => {
            if (error.status === 401) {
                sessionStorage.removeItem(TOKEN_KEY);
                window.location.replace('messenger.html');
                return;
            }
            showStatus(aiStatus, error.message);
        });
    }
}

document.querySelectorAll('[data-action="spellcheck"]').forEach((button) => {
    button.addEventListener('click', () => {
        if (!messageInput) {
            window.location.href = 'messenger.html#message-input';
            return;
        }
        messageInput.spellcheck = true;
        messageInput.focus();
    });
});
