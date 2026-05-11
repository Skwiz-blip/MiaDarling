// =====================================================
// FORUM ANONYME - Version Migrée avec Supabase
// =====================================================
// Migration depuis window.storage vers Supabase
// Conservation du design visuel existant
// =====================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';

const SUPABASE_URL = 'https://yeawjdkyqjyjvpahlbmp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllYXdqZGt5cWp5anZwYWhsYm1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NzQ2MzAsImV4cCI6MjA5MjI1MDYzMH0.DP3kRbQ0UH7moDkaF61y9wmlqupLXjClj6PSqROQNlA';

let supabase = null;

// =====================================================
// SESSION MANAGER
// =====================================================
const SessionManager = {
  STORAGE_KEY: 'forum_anonymous_session',

  async init() {
    if (!supabase) {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return this.getOrCreateSession();
  },

  async getOrCreateSession() {
    let sessionToken = localStorage.getItem(this.STORAGE_KEY);

    if (sessionToken) {
      const { data, error } = await supabase
        .from('anonymous_sessions')
        .select('*')
        .eq('session_token', sessionToken)
        .single();

      if (data && !data.is_banned) {
        await supabase
          .from('anonymous_sessions')
          .update({ last_activity_at: new Date().toISOString() })
          .eq('session_token', sessionToken);

        return { sessionToken, session: data };
      }
    }

    // Créer nouvelle session
    const newToken = this.generateToken();
    const anonymousName = this.generateAnonymousName();

    const { data, error } = await supabase
      .from('anonymous_sessions')
      .insert({
        session_token: newToken,
        anonymous_name: anonymousName
      })
      .select()
      .single();

    if (error) {
      console.error('Erreur création session:', error);
      return null;
    }

    localStorage.setItem(this.STORAGE_KEY, newToken);
    return { sessionToken: newToken, session: data };
  },

  generateToken() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  },

  generateAnonymousName() {
    const adjectives = ['Silent', 'Hidden', 'Secret', 'Mystère', 'Ombre', 'Brume', 'Voile', 'Écho', 'Whisper', 'Shadow'];
    const nouns = ['Voyageur', 'Rêveur', 'Penseur', 'Âme', 'Coeur', 'Esprit', 'Voix', 'Souffle', 'Walker', 'Soul'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 9999);
    return `${adj}${noun}${num}`;
  },

  getToken() {
    return localStorage.getItem(this.STORAGE_KEY);
  },

  async getSessionInfo() {
    const token = this.getToken();
    if (!token) return null;

    const { data, error } = await supabase
      .from('anonymous_sessions')
      .select('*')
      .eq('session_token', token)
      .single();

    return error ? null : data;
  }
};

// =====================================================
// API POSTS (anciennement threads)
// =====================================================
const PostsAPI = {
  async getRecent(limit = 20, offset = 0) {
    const { data, error } = await supabase
      .from('posts')
      .select(`
        *,
        anonymous_sessions (anonymous_name)
      `)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Erreur récupération posts:', error);
      return [];
    }

    return this.formatPosts(data);
  },

  async getPopular(limit = 20) {
    const { data, error } = await supabase
      .from('posts')
      .select(`
        *,
        anonymous_sessions (anonymous_name)
      `)
      .eq('status', 'published')
      .order('reactions_count', { ascending: false })
      .order('views_count', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Erreur récupération posts populaires:', error);
      return [];
    }

    return this.formatPosts(data);
  },

  async getById(postId) {
    const { data, error } = await supabase
      .from('posts')
      .select(`
        *,
        anonymous_sessions (anonymous_name)
      `)
      .eq('id', postId)
      .single();

    if (error) {
      console.error('Erreur récupération post:', error);
      return null;
    }

    return this.formatPost(data);
  },

  async getMyPosts() {
    const sessionToken = SessionManager.getToken();
    if (!sessionToken) return [];

    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .eq('session_token', sessionToken)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erreur récupération mes posts:', error);
      return [];
    }

    return this.formatPosts(data);
  },

  async create(content) {
    const sessionToken = SessionManager.getToken();
    if (!sessionToken) {
      await SessionManager.getOrCreateSession();
    }

    const { data, error } = await supabase
      .from('posts')
      .insert({
        session_token: SessionManager.getToken(),
        content: content,
        status: 'published'
      })
      .select()
      .single();

    if (error) {
      console.error('Erreur création post:', error);
      return null;
    }

    return data;
  },

  async delete(postId) {
    const sessionToken = SessionManager.getToken();

    const { error } = await supabase
      .from('posts')
      .update({ status: 'deleted' })
      .eq('id', postId)
      .eq('session_token', sessionToken);

    return !error;
  },

  async recordView(postId) {
    const sessionToken = SessionManager.getToken();
    if (!sessionToken) return;

    // Vérifier si déjà vu
    const { data: existing } = await supabase
      .from('post_views')
      .select('id')
      .eq('post_id', postId)
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (!existing) {
      await supabase.from('post_views').insert({
        post_id: postId,
        session_token: sessionToken
      });
    }
  },

  formatPosts(posts) {
    return posts.map(p => this.formatPost(p));
  },

  formatPost(post) {
    return {
      id: post.id,
      content: post.content,
      authorName: post.anonymous_sessions?.anonymous_name || 'Anonyme',
      createdAt: post.created_at,
      timeAgo: this.timeAgo(post.created_at),
      viewsCount: post.views_count || 0,
      commentsCount: post.comments_count || 0,
      reactionsCount: post.reactions_count || 0,
      isOwn: post.session_token === SessionManager.getToken()
    };
  },

  timeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return "À l'instant";
    if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)} min`;
    if (seconds < 86400) return `il y a ${Math.floor(seconds / 3600)}h`;
    if (seconds < 604800) return `il y a ${Math.floor(seconds / 86400)} jours`;
    return `il y a ${Math.floor(seconds / 604800)} sem.`;
  }
};

// =====================================================
// API COMMENTS (anciennement messages)
// =====================================================
const CommentsAPI = {
  async getForPost(postId) {
    const { data, error } = await supabase
      .from('comments')
      .select(`
        *,
        anonymous_sessions (anonymous_name)
      `)
      .eq('post_id', postId)
      .eq('status', 'visible')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Erreur récupération commentaires:', error);
      return [];
    }

    return this.formatComments(data);
  },

  async create(postId, content, parentCommentId = null) {
    const sessionToken = SessionManager.getToken();
    if (!sessionToken) {
      await SessionManager.getOrCreateSession();
    }

    const { data, error } = await supabase
      .from('comments')
      .insert({
        post_id: postId,
        parent_comment_id: parentCommentId,
        session_token: SessionManager.getToken(),
        content: content
      })
      .select(`
        *,
        anonymous_sessions (anonymous_name)
      `)
      .single();

    if (error) {
      console.error('Erreur création commentaire:', error);
      return null;
    }

    return this.formatComment(data);
  },

  async delete(commentId) {
    const sessionToken = SessionManager.getToken();

    const { error } = await supabase
      .from('comments')
      .update({ status: 'deleted' })
      .eq('id', commentId)
      .eq('session_token', sessionToken);

    return !error;
  },

  async toggleLike(commentId) {
    const sessionToken = SessionManager.getToken();
    if (!sessionToken) return { action: null, success: false };

    const { data: existing } = await supabase
      .from('comment_likes')
      .select('comment_id')
      .eq('comment_id', commentId)
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('comment_likes')
        .delete()
        .eq('comment_id', commentId)
        .eq('session_token', sessionToken);

      return { action: 'unliked', success: !error };
    } else {
      const { error } = await supabase
        .from('comment_likes')
        .insert({
          comment_id: commentId,
          session_token: sessionToken
        });

      return { action: 'liked', success: !error };
    }
  },

  formatComments(comments) {
    return comments.map(c => this.formatComment(c));
  },

  formatComment(comment) {
    return {
      id: comment.id,
      postId: comment.post_id,
      parentId: comment.parent_comment_id,
      authorName: comment.anonymous_sessions?.anonymous_name || 'Anonyme',
      content: comment.content,
      createdAt: comment.created_at,
      timeAgo: PostsAPI.timeAgo(comment.created_at),
      likesCount: comment.likes_count || 0,
      isOwn: comment.session_token === SessionManager.getToken()
    };
  }
};

// =====================================================
// API RÉACTIONS
// =====================================================
const ReactionsAPI = {
  async getForPost(postId) {
    const { data, error } = await supabase
      .from('reaction_counts')
      .select(`
        count,
        reaction_types (id, name, emoji)
      `)
      .eq('post_id', postId);

    if (error) {
      console.error('Erreur récupération réactions:', error);
      return [];
    }

    return data.map(r => ({
      typeId: r.reaction_types.id,
      name: r.reaction_types.name,
      emoji: r.reaction_types.emoji,
      count: r.count
    }));
  },

  async toggle(postId, reactionTypeId) {
    const sessionToken = SessionManager.getToken();
    if (!sessionToken) {
      await SessionManager.getOrCreateSession();
    }

    const { data: existing } = await supabase
      .from('post_reactions')
      .select('id')
      .eq('post_id', postId)
      .eq('reaction_type_id', reactionTypeId)
      .eq('session_token', SessionManager.getToken())
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('post_reactions')
        .delete()
        .eq('id', existing.id);

      return { action: 'removed', success: !error };
    } else {
      const { error } = await supabase
        .from('post_reactions')
        .insert({
          post_id: postId,
          reaction_type_id: reactionTypeId,
          session_token: SessionManager.getToken()
        });

      return { action: 'added', success: !error };
    }
  },

  async getUserReactions(postId) {
    const sessionToken = SessionManager.getToken();
    if (!sessionToken) return [];

    const { data, error } = await supabase
      .from('post_reactions')
      .select('reaction_type_id')
      .eq('post_id', postId)
      .eq('session_token', sessionToken);

    if (error) return [];

    return data.map(r => r.reaction_type_id);
  }
};

// =====================================================
// API BROUILLONS
// =====================================================
const DraftsAPI = {
  async getCurrent() {
    const sessionToken = SessionManager.getToken();
    if (!sessionToken) return null;

    const { data, error } = await supabase
      .from('drafts')
      .select('*')
      .eq('session_token', sessionToken)
      .single();

    if (error) return null;

    return {
      id: data.id,
      content: data.content,
      updatedAt: data.updated_at
    };
  },

  async save(content) {
    const sessionToken = SessionManager.getToken();
    if (!sessionToken) {
      await SessionManager.getOrCreateSession();
    }

    const existing = await this.getCurrent();

    if (existing) {
      await supabase
        .from('drafts')
        .update({
          content: content,
          auto_saved_at: new Date().toISOString()
        })
        .eq('id', existing.id);

      return existing.id;
    } else {
      const { data, error } = await supabase
        .from('drafts')
        .insert({
          session_token: SessionManager.getToken(),
          content: content
        })
        .select()
        .single();

      return error ? null : data.id;
    }
  },

  async delete() {
    const sessionToken = SessionManager.getToken();
    if (!sessionToken) return;

    await supabase
      .from('drafts')
      .delete()
      .eq('session_token', sessionToken);
  }
};

// =====================================================
// API STATISTIQUES
// =====================================================
const StatsAPI = {
  async getMyStats() {
    const sessionToken = SessionManager.getToken();
    if (!sessionToken) return { postsCount: 0, reactionsCount: 0, viewsCount: 0 };

    const { data: posts } = await supabase
      .from('posts')
      .select('reactions_count, views_count')
      .eq('session_token', sessionToken)
      .neq('status', 'deleted');

    if (!posts || posts.length === 0) {
      return { postsCount: 0, reactionsCount: 0, viewsCount: 0 };
    }

    return {
      postsCount: posts.length,
      reactionsCount: posts.reduce((sum, p) => sum + (p.reactions_count || 0), 0),
      viewsCount: posts.reduce((sum, p) => sum + (p.views_count || 0), 0)
    };
  }
};

// =====================================================
// COMPOSANTS REACT
// =====================================================

// Styles CSS (conservés du design original)
const styles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: linear-gradient(135deg, #0d0015 0%, #1a0033 50%, #0d0015 100%);
    color: #f5f5f5;
    min-height: 100vh;
  }
  
  .container {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
  }
  
  .header {
    text-align: center;
    padding: 40px 20px;
    border-bottom: 1px solid rgba(166, 108, 255, 0.2);
    margin-bottom: 30px;
  }
  
  .header h1 {
    font-size: 2.5rem;
    background: linear-gradient(135deg, #a66cff 0%, #ff6bb3 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 10px;
  }
  
  .header p {
    color: rgba(255, 255, 255, 0.6);
    font-size: 1rem;
  }
  
  .tabs {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 10px;
  }
  
  .tab {
    padding: 10px 20px;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    font-size: 1rem;
    border-radius: 8px 8px 0 0;
    transition: all 0.2s;
  }
  
  .tab:hover {
    color: #a66cff;
    background: rgba(166, 108, 255, 0.1);
  }
  
  .tab.active {
    color: #a66cff;
    background: rgba(166, 108, 255, 0.15);
    border-bottom: 2px solid #a66cff;
  }
  
  .post-card {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    padding: 20px;
    margin-bottom: 15px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .post-card:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(166, 108, 255, 0.3);
    transform: translateY(-2px);
  }
  
  .post-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  
  .post-author {
    font-weight: 600;
    color: #a66cff;
  }
  
  .post-time {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.4);
  }
  
  .post-content {
    font-size: 1rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.9);
    margin-bottom: 15px;
  }
  
  .post-stats {
    display: flex;
    gap: 20px;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.5);
  }
  
  .post-stat {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  
  .reactions-bar {
    display: flex;
    gap: 10px;
    margin-top: 15px;
    padding-top: 15px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .reaction-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 50px;
    cursor: pointer;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.7);
    transition: all 0.2s;
  }
  
  .reaction-btn:hover {
    background: rgba(166, 108, 255, 0.15);
    border-color: rgba(166, 108, 255, 0.4);
  }
  
  .reaction-btn.active {
    background: rgba(166, 108, 255, 0.2);
    border-color: #a66cff;
    color: #a66cff;
  }
  
  .reaction-emoji {
    font-size: 1.1rem;
  }
  
  .reaction-count {
    font-weight: 600;
  }
  
  .comment-section {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .comment {
    background: rgba(255, 255, 255, 0.03);
    border-radius: 12px;
    padding: 15px;
    margin-bottom: 10px;
  }
  
  .comment.own {
    background: rgba(166, 108, 255, 0.1);
    border-left: 3px solid #a66cff;
  }
  
  .comment-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  
  .comment-author {
    font-weight: 600;
    font-size: 0.9rem;
    color: #a66cff;
  }
  
  .comment-time {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.4);
  }
  
  .comment-content {
    font-size: 0.95rem;
    line-height: 1.5;
  }
  
  .comment-actions {
    display: flex;
    gap: 15px;
    margin-top: 10px;
  }
  
  .comment-action {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 5px;
    transition: color 0.2s;
  }
  
  .comment-action:hover {
    color: #a66cff;
  }
  
  .comment-action.liked {
    color: #ff6b9d;
  }
  
  .comment-input-area {
    display: flex;
    gap: 10px;
    margin-top: 15px;
  }
  
  .comment-input {
    flex: 1;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 12px 16px;
    color: #fff;
    font-size: 0.95rem;
    resize: none;
  }
  
  .comment-input:focus {
    outline: none;
    border-color: rgba(166, 108, 255, 0.5);
  }
  
  .comment-submit {
    background: #a66cff;
    color: #1a0033;
    border: none;
    border-radius: 12px;
    padding: 12px 20px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .comment-submit:hover {
    background: #c49fff;
    transform: scale(1.02);
  }
  
  .new-post-area {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    padding: 20px;
    margin-bottom: 30px;
  }
  
  .new-post-textarea {
    width: 100%;
    min-height: 120px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 15px;
    color: #fff;
    font-size: 1rem;
    resize: vertical;
    margin-bottom: 15px;
  }
  
  .new-post-textarea:focus {
    outline: none;
    border-color: rgba(166, 108, 255, 0.5);
  }
  
  .new-post-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .char-count {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.4);
  }
  
  .char-count.warning {
    color: #ff6b6b;
  }
  
  .submit-btn {
    background: linear-gradient(135deg, #a66cff 0%, #ff6bb3 100%);
    color: #fff;
    border: none;
    border-radius: 50px;
    padding: 12px 30px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .submit-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 20px rgba(166, 108, 255, 0.4);
  }
  
  .submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
  
  .draft-indicator {
    font-size: 0.8rem;
    color: rgba(166, 108, 255, 0.7);
    margin-top: 10px;
  }
  
  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: rgba(255, 255, 255, 0.4);
  }
  
  .empty-state h3 {
    margin-bottom: 10px;
    color: rgba(255, 255, 255, 0.6);
  }
  
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 8px 16px;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    margin-bottom: 20px;
    transition: all 0.2s;
  }
  
  .back-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #a66cff;
  }
  
  .history-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 15px;
    margin-bottom: 30px;
  }
  
  .stat-card {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 20px;
    text-align: center;
  }
  
  .stat-value {
    font-size: 2rem;
    font-weight: 700;
    color: #a66cff;
  }
  
  .stat-label {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.5);
    margin-top: 5px;
  }
  
  .delete-btn {
    background: rgba(255, 107, 107, 0.1);
    border: 1px solid rgba(255, 107, 107, 0.3);
    color: #ff6b6b;
    padding: 6px 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.8rem;
    transition: all 0.2s;
  }
  
  .delete-btn:hover {
    background: rgba(255, 107, 107, 0.2);
    border-color: #ff6b6b;
  }
  
  .loading {
    text-align: center;
    padding: 40px;
    color: rgba(255, 255, 255, 0.4);
  }
`;

// =====================================================
// COMPOSANT PRINCIPAL
// =====================================================

export default function ForumAnonymous() {
  const [session, setSession] = useState(null);
  const [currentView, setCurrentView] = useState('recent'); // 'recent', 'popular', 'history', 'post'
  const [posts, setPosts] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [userReactions, setUserReactions] = useState([]);
  const [newPostContent, setNewPostContent] = useState('');
  const [newCommentContent, setNewCommentContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ postsCount: 0, reactionsCount: 0, viewsCount: 0 });
  const [draftSaved, setDraftSaved] = useState(false);

  const draftTimerRef = useRef(null);

  // Initialisation
  useEffect(() => {
    const init = async () => {
      // Charger le script Supabase si nécessaire
      if (!window.supabase) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        script.onload = async () => {
          await loadData();
        };
        document.head.appendChild(script);
      } else {
        await loadData();
      }
    };

    const loadData = async () => {
      setLoading(true);
      const sessionData = await SessionManager.init();
      setSession(sessionData);

      const postsData = await PostsAPI.getRecent(20);
      setPosts(postsData);

      const statsData = await StatsAPI.getMyStats();
      setStats(statsData);

      // Charger le brouillon existant
      const draft = await DraftsAPI.getCurrent();
      if (draft && draft.content) {
        setNewPostContent(draft.content);
      }

      setLoading(false);
    };

    init();
  }, []);

  // Auto-sauvegarde des brouillons
  useEffect(() => {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
    }

    if (newPostContent.length > 10) {
      draftTimerRef.current = setTimeout(async () => {
        await DraftsAPI.save(newPostContent);
        setDraftSaved(true);
        setTimeout(() => setDraftSaved(false), 2000);
      }, 3000);
    }

    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
      }
    };
  }, [newPostContent]);

  // Charger les posts selon la vue
  const loadPosts = useCallback(async (view) => {
    setLoading(true);
    let data;

    if (view === 'recent') {
      data = await PostsAPI.getRecent(20);
    } else if (view === 'popular') {
      data = await PostsAPI.getPopular(20);
    } else if (view === 'history') {
      data = await PostsAPI.getMyPosts();
      const statsData = await StatsAPI.getMyStats();
      setStats(statsData);
    }

    setPosts(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (currentView !== 'post') {
      loadPosts(currentView);
    }
  }, [currentView, loadPosts]);

  // Ouvrir un post
  const openPost = async (post) => {
    setLoading(true);
    setSelectedPost(post);
    setCurrentView('post');

    // Enregistrer la vue
    await PostsAPI.recordView(post.id);

    // Charger les commentaires
    const commentsData = await CommentsAPI.getForPost(post.id);
    setComments(commentsData);

    // Charger les réactions
    const reactionsData = await ReactionsAPI.getForPost(post.id);
    setReactions(reactionsData);

    // Charger les réactions de l'utilisateur
    const userReactionsData = await ReactionsAPI.getUserReactions(post.id);
    setUserReactions(userReactionsData);

    setLoading(false);
  };

  // Créer un post
  const handleCreatePost = async () => {
    if (newPostContent.length < 10) return;

    setLoading(true);
    const post = await PostsAPI.create(newPostContent);

    if (post) {
      setNewPostContent('');
      await DraftsAPI.delete();
      setCurrentView('recent');
      const postsData = await PostsAPI.getRecent(20);
      setPosts(postsData);
    }

    setLoading(false);
  };

  // Créer un commentaire
  const handleCreateComment = async () => {
    if (!newCommentContent.trim() || !selectedPost) return;

    const comment = await CommentsAPI.create(selectedPost.id, newCommentContent);

    if (comment) {
      setNewCommentContent('');
      const commentsData = await CommentsAPI.getForPost(selectedPost.id);
      setComments(commentsData);
    }
  };

  // Toggle réaction
  const handleToggleReaction = async (reactionTypeId) => {
    if (!selectedPost) return;

    const result = await ReactionsAPI.toggle(selectedPost.id, reactionTypeId);

    if (result.success) {
      // Recharger les réactions
      const reactionsData = await ReactionsAPI.getForPost(selectedPost.id);
      setReactions(reactionsData);

      const userReactionsData = await ReactionsAPI.getUserReactions(selectedPost.id);
      setUserReactions(userReactionsData);
    }
  };

  // Toggle like commentaire
  const handleToggleCommentLike = async (commentId) => {
    const result = await CommentsAPI.toggleLike(commentId);

    if (result.success) {
      const commentsData = await CommentsAPI.getForPost(selectedPost.id);
      setComments(commentsData);
    }
  };

  // Supprimer un post
  const handleDeletePost = async (postId) => {
    if (!confirm('Supprimer ce témoignage ?')) return;

    const success = await PostsAPI.delete(postId);

    if (success) {
      if (currentView === 'post') {
        setCurrentView('recent');
      } else {
        loadPosts(currentView);
      }
    }
  };

  // Rendu des réactions
  const renderReactions = () => {
    const defaultReactions = [
      { id: 1, name: 'cry', emoji: '😢', count: 0 },
      { id: 2, name: 'sad', emoji: '😔', count: 0 },
      { id: 3, name: 'heart', emoji: '❤️', count: 0 }
    ];

    const mergedReactions = defaultReactions.map(dr => {
      const found = reactions.find(r => r.typeId === dr.id);
      return found || dr;
    });

    return (
      <div className="reactions-bar">
        {mergedReactions.map(reaction => (
          <button
            key={reaction.id}
            className={`reaction-btn ${userReactions.includes(reaction.id) ? 'active' : ''}`}
            onClick={() => handleToggleReaction(reaction.id)}
          >
            <span className="reaction-emoji">{reaction.emoji}</span>
            <span className="reaction-count">{reaction.count}</span>
          </button>
        ))}
      </div>
    );
  };

  // Rendu d'un post dans la liste
  const renderPostCard = (post) => (
    <div key={post.id} className="post-card" onClick={() => openPost(post)}>
      <div className="post-header">
        <span className="post-author">{post.authorName}</span>
        <span className="post-time">{post.timeAgo}</span>
      </div>
      <div className="post-content">{post.content}</div>
      <div className="post-stats">
        <span className="post-stat">👁 {post.viewsCount}</span>
        <span className="post-stat">💬 {post.commentsCount}</span>
        <span className="post-stat">❤️ {post.reactionsCount}</span>
      </div>
    </div>
  );

  // Rendu détaillé d'un post
  const renderPostDetail = () => (
    <div>
      <button className="back-btn" onClick={() => setCurrentView('recent')}>
        ← Retour
      </button>

      <div className="post-card">
        <div className="post-header">
          <span className="post-author">{selectedPost.authorName}</span>
          <span className="post-time">{selectedPost.timeAgo}</span>
        </div>
        <div className="post-content">{selectedPost.content}</div>
        <div className="post-stats">
          <span className="post-stat">👁 {selectedPost.viewsCount}</span>
          <span className="post-stat">💬 {selectedPost.commentsCount}</span>
          <span className="post-stat">❤️ {selectedPost.reactionsCount}</span>
        </div>

        {renderReactions()}

        {selectedPost.isOwn && (
          <button
            className="delete-btn"
            onClick={(e) => { e.stopPropagation(); handleDeletePost(selectedPost.id); }}
            style={{ marginTop: '15px' }}
          >
            Supprimer
          </button>
        )}
      </div>

      <div className="comment-section">
        <h3 style={{ marginBottom: '15px' }}>Commentaires ({comments.length})</h3>

        {comments.map(comment => (
          <div key={comment.id} className={`comment ${comment.isOwn ? 'own' : ''}`}>
            <div className="comment-header">
              <span className="comment-author">
                {comment.authorName}
                {comment.isOwn && ' (vous)'}
              </span>
              <span className="comment-time">{comment.timeAgo}</span>
            </div>
            <div className="comment-content">{comment.content}</div>
            <div className="comment-actions">
              <button
                className={`comment-action ${comment.isLiked ? 'liked' : ''}`}
                onClick={() => handleToggleCommentLike(comment.id)}
              >
                ❤️ {comment.likesCount}
              </button>
            </div>
          </div>
        ))}

        <div className="comment-input-area">
          <textarea
            className="comment-input"
            placeholder="Écrire un commentaire..."
            value={newCommentContent}
            onChange={(e) => setNewCommentContent(e.target.value)}
            rows={2}
          />
          <button
            className="comment-submit"
            onClick={handleCreateComment}
            disabled={!newCommentContent.trim()}
          >
            Envoyer
          </button>
        </div>
      </div>
    </div>
  );

  // Rendu de l'historique
  const renderHistory = () => (
    <div>
      <div className="history-stats">
        <div className="stat-card">
          <div className="stat-value">{stats.postsCount}</div>
          <div className="stat-label">Posts</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.reactionsCount}</div>
          <div className="stat-label">Réactions reçues</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.viewsCount}</div>
          <div className="stat-label">Vues</div>
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="empty-state">
          <h3>Aucun témoignage</h3>
          <p>Vous n'avez encore rien partagé</p>
        </div>
      ) : (
        posts.map(post => (
          <div key={post.id} className="post-card" onClick={() => openPost(post)}>
            <div className="post-header">
              <span className="post-author">{post.authorName}</span>
              <span className="post-time">{post.timeAgo}</span>
            </div>
            <div className="post-content">{post.content}</div>
            <div className="post-stats">
              <span className="post-stat">👁 {post.viewsCount}</span>
              <span className="post-stat">💬 {post.commentsCount}</span>
              <span className="post-stat">❤️ {post.reactionsCount}</span>
            </div>
            <button
              className="delete-btn"
              onClick={(e) => { e.stopPropagation(); handleDeletePost(post.id); }}
              style={{ marginTop: '10px' }}
            >
              Supprimer
            </button>
          </div>
        ))
      )}
    </div>
  );

  return (
    <>
      <style>{styles}</style>

      <div className="container">
        <header className="header">
          <h1>Forum Anonyme</h1>
          <p>
            {session?.session?.anonymous_name || 'Chargement...'}
            {' • '}Espace de partage libre et confidentiel
          </p>
        </header>

        {currentView !== 'post' && currentView !== 'history' && (
          <div className="new-post-area">
            <textarea
              className="new-post-textarea"
              placeholder="Partagez vos pensées, vos émotions, vos expériences..."
              value={newPostContent}
              onChange={(e) => setNewPostContent(e.target.value)}
              maxLength={2000}
            />
            <div className="new-post-footer">
              <span className={`char-count ${newPostContent.length > 1900 ? 'warning' : ''}`}>
                {newPostContent.length}/2000
              </span>
              {draftSaved && <span className="draft-indicator">✓ Brouillon sauvegardé</span>}
              <button
                className="submit-btn"
                onClick={handleCreatePost}
                disabled={newPostContent.length < 10}
              >
                Publier anonymement
              </button>
            </div>
          </div>
        )}

        <div className="tabs">
          <button
            className={`tab ${currentView === 'recent' ? 'active' : ''}`}
            onClick={() => setCurrentView('recent')}
          >
            Récents
          </button>
          <button
            className={`tab ${currentView === 'popular' ? 'active' : ''}`}
            onClick={() => setCurrentView('popular')}
          >
            Populaires
          </button>
          <button
            className={`tab ${currentView === 'history' ? 'active' : ''}`}
            onClick={() => setCurrentView('history')}
          >
            Mon historique
          </button>
        </div>

        {loading ? (
          <div className="loading">Chargement...</div>
        ) : (
          <>
            {currentView === 'post' && renderPostDetail()}
            {currentView === 'history' && renderHistory()}
            {(currentView === 'recent' || currentView === 'popular') && (
              posts.length === 0 ? (
                <div className="empty-state">
                  <h3>Aucun témoignage</h3>
                  <p>Soyez le premier à partager</p>
                </div>
              ) : (
                posts.map(renderPostCard)
              )
            )}
          </>
        )}
      </div>
    </>
  );
}
