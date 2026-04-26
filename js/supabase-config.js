const SUPABASE_URL = 'https://yeawjdkyqjyjvpahlbmp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllYXdqZGt5cWp5anZwYWhsYm1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NzQ2MzAsImV4cCI6MjA5MjI1MDYzMH0.DP3kRbQ0UH7moDkaF61y9wmlqupLXjClj6PSqROQNlA';

// Initialisation du client Supabase
let supabaseClient = null;

function initSupabase() {
    if (window.supabase && window.supabase.createClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('Supabase client initialisé');
        return true;
    }
    return false;
}

if (!initSupabase()) {
    window.addEventListener('load', initSupabase);
}


const SessionManager = {
    STORAGE_KEY: 'mia_darling_session',

    async getOrCreateSession() {
        let sessionToken = localStorage.getItem(this.STORAGE_KEY);

        if (sessionToken) {
            const { data, error } = await supabaseClient
                .from('anonymous_sessions')
                .select('*')
                .eq('session_token', sessionToken)
                .single();

            if (data && !data.is_banned) {
                await supabaseClient
                    .from('anonymous_sessions')
                    .update({ last_activity_at: new Date().toISOString() })
                    .eq('session_token', sessionToken);

                return { sessionToken, session: data };
            }
        }

        const newToken = this.generateToken();
        const anonymousName = this.generateAnonymousName();

        const { data, error } = await supabaseClient
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
        const adjectives = ['Silent', 'Hidden', 'Secret', 'Mystère', 'Ombre', 'Brume', 'Voile', 'Écho'];
        const nouns = ['Voyageur', 'Rêveur', 'Penseur', 'Âme', 'Coeur', 'Esprit', 'Voix', 'Souffle'];
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

        const { data, error } = await supabaseClient
            .from('anonymous_sessions')
            .select('*')
            .eq('session_token', token)
            .single();

        return error ? null : data;
    },
    async getRecoveryCode() {
        const token = this.getToken();
        if (!token) return null;

        const { data, error } = await supabaseClient
            .from('anonymous_sessions')
            .select('recovery_code')
            .eq('session_token', token)
            .single();

        return error ? null : data?.recovery_code;
    },

    async recoverAccount(recoveryCode) {
        const cleanCode = recoveryCode.toUpperCase().trim();

        const { data, error } = await supabaseClient
            .from('anonymous_sessions')
            .select('session_token, anonymous_name')
            .eq('recovery_code', cleanCode)
            .single();

        if (error || !data) {
            return { success: false, error: 'Code de récupération invalide' };
        }

        // Sauvegarder le token dans localStorage
        localStorage.setItem(this.STORAGE_KEY, data.session_token);

        return {
            success: true,
            sessionToken: data.session_token,
            anonymousName: data.anonymous_name
        };
    },

    /**
     * Ajoute un email de récupération optionnel
     */
    async setRecoveryEmail(email) {
        const token = this.getToken();
        if (!token) return { success: false, error: 'Pas de session active' };

        const { error } = await supabaseClient
            .from('anonymous_sessions')
            .update({
                recovery_email: email.toLowerCase().trim(),
                recovery_email_verified: false
            })
            .eq('session_token', token);

        return { success: !error, error: error?.message };
    },

    /**
     * Récupère un compte via un email
     */
    async recoverByEmail(email) {
        const cleanEmail = email.toLowerCase().trim();

        const { data, error } = await supabaseClient
            .from('anonymous_sessions')
            .select('session_token, anonymous_name, recovery_code')
            .eq('recovery_email', cleanEmail)
            .single();

        if (error || !data) {
            return { success: false, error: 'Email non trouvé' };
        }

        // Sauvegarder le token dans localStorage
        localStorage.setItem(this.STORAGE_KEY, data.session_token);

        return {
            success: true,
            sessionToken: data.session_token,
            anonymousName: data.anonymous_name,
            recoveryCode: data.recovery_code
        };
    }
};

const PostsAPI = {
    async getRecent(limit = 20, offset = 0) {
        const { data, error } = await supabaseClient
            .from('posts')
            .select(`
                *,
                post_moods (moods (id, name, emoji)),
                post_tags (tags (id, name, slug))
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
        const { data, error } = await supabaseClient
            .from('posts')
            .select(`
                *,
                post_moods (moods (id, name, emoji)),
                post_tags (tags (id, name, slug))
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

    /**
     * Récupère les posts tendance (mélange fraîcheur + popularité)
     * Score = (réactions * 3 + vues) / (heures depuis publication + 2)^1.5
     */
    async getTrending(limit = 20) {
        // Utiliser getRecent puis trier côté client
        const { data, error } = await supabaseClient
            .from('posts')
            .select(`
                id,
                content,
                created_at,
                views_count,
                reactions_count,
                status,
                post_moods (moods (id, name, emoji)),
                post_tags (tags (id, name, slug))
            `)
            .eq('status', 'published')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.error('Erreur récupération posts tendance:', error);
            // Fallback vers getRecent simple
            return this.getRecent(limit);
        }

        const now = new Date();
        const scored = data.map(post => {
            const hoursSincePost = (now - new Date(post.created_at)) / (1000 * 60 * 60);
            const reactions = post.reactions_count || 0;
            const views = post.views_count || 0;
            const score = (reactions * 3 + views) / Math.pow(hoursSincePost + 2, 1.5);
            return { ...post, trendingScore: score };
        });

        scored.sort((a, b) => b.trendingScore - a.trendingScore);
        return this.formatPosts(scored.slice(0, limit));
    },

    async getById(postId) {
        const { data, error } = await supabaseClient
            .from('posts')
            .select(`
                *,
                post_moods (moods (id, name, emoji)),
                post_tags (tags (id, name, slug))
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

        const { data, error } = await supabaseClient
            .from('posts')
            .select(`
                *,
                post_moods (moods (id, name, emoji)),
                post_tags (tags (id, name, slug))
            `)
            .eq('session_token', sessionToken)
            .neq('status', 'deleted')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Erreur récupération mes posts:', error);
            return [];
        }

        return this.formatPosts(data);
    },

    async create(content, moodIds = [], tagNames = []) {
        const sessionToken = SessionManager.getToken();
        if (!sessionToken) {
            await SessionManager.getOrCreateSession();
        }

        console.log('Création post avec session:', SessionManager.getToken());

        const { data: post, error: postError } = await supabaseClient
            .from('posts')
            .insert({
                session_token: SessionManager.getToken(),
                content: content,
                status: 'published'
            })
            .select()
            .single();

        if (postError) {
            console.error('Erreur création post:', postError);
            return null;
        }

        console.log('Post créé avec ID:', post.id);

        if (moodIds.length > 0) {
            const moodInserts = moodIds.map(moodId => ({
                post_id: post.id,
                mood_id: moodId
            }));
            await supabaseClient.from('post_moods').insert(moodInserts);
        }

        if (tagNames.length > 0) {
            for (const tagName of tagNames) {
                let tag = await this.getOrCreateTag(tagName);
                if (tag) {
                    await supabaseClient.from('post_tags').insert({
                        post_id: post.id,
                        tag_id: tag.id
                    });
                }
            }
        }

        return post;
    },

    async update(postId, content) {
        const sessionToken = SessionManager.getToken();

        const { data, error } = await supabaseClient
            .from('posts')
            .update({
                content: content,
                is_edited: true
            })
            .eq('id', postId)
            .eq('session_token', sessionToken)
            .select()
            .single();

        if (error) {
            console.error('Erreur mise à jour post:', error);
            return null;
        }

        return data;
    },

    async delete(postId) {
        const sessionToken = SessionManager.getToken();

        const { error } = await supabaseClient
            .from('posts')
            .update({ status: 'deleted' })
            .eq('id', postId)
            .eq('session_token', sessionToken);

        return !error;
    },

    /**
     * Enregistre une vue
     */
    async recordView(postId) {
        try {
            const sessionToken = SessionManager.getToken();
            if (!sessionToken) {
                await SessionManager.getOrCreateSession();
            }

            // Vérifier si déjà vu par cette session
            const { data: existing } = await supabaseClient
                .from('post_views')
                .select('id')
                .eq('post_id', postId)
                .eq('session_token', SessionManager.getToken())
                .maybeSingle();

            if (!existing) {
                // Enregistrer la vue
                await supabaseClient.from('post_views').insert({
                    post_id: postId,
                    session_token: SessionManager.getToken()
                });

                // Incrémenter le compteur de vues via RPC (ignore erreur si fonction n'existe pas)
                try {
                    await supabaseClient.rpc('increment_view_count', { post_id: postId });
                } catch (rpcError) {
                    console.warn('RPC increment_view_count non disponible:', rpcError.message);
                }
            }
        } catch (error) {
            console.warn('Erreur enregistrement vue (non bloquante):', error.message);
        }
    },

    /**
     * Trouve ou crée un tag
     */
    async getOrCreateTag(tagName) {
        const cleanName = tagName.replace(/^#/, '').trim();
        const slug = cleanName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '-');

        // Chercher le tag existant
        const { data: existing } = await supabaseClient
            .from('tags')
            .select('*')
            .eq('slug', slug)
            .single();

        if (existing) return existing;

        // Créer le tag
        const { data: newTag, error } = await supabaseClient
            .from('tags')
            .insert({ name: cleanName, slug: slug })
            .select()
            .single();

        return error ? null : newTag;
    },

    /**
     * Formate une liste de posts
     */
    formatPosts(posts) {
        return posts.map(p => this.formatPost(p));
    },

    /**
     * Formate un post
     */
    formatPost(post) {
        return {
            id: post.id,
            content: post.content,
            authorName: 'Anonyme',
            createdAt: post.created_at,
            timeAgo: this.timeAgo(post.created_at),
            isEdited: post.is_edited,
            viewsCount: post.views_count || 0,
            commentsCount: post.comments_count || 0,
            reactionsCount: post.reactions_count || 0,
            moods: post.post_moods?.map(pm => pm.moods) || [],
            tags: post.post_tags?.map(pt => pt.tags) || []
        };
    },

    /**
     * Calcule le temps écoulé
     */
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
// OPÉRATIONS SUR LES RÉACTIONS
// =====================================================

const ReactionsAPI = {
    /**
     * Récupère les réactions d'un post
     */
    async getForPost(postId) {
        const { data, error } = await supabaseClient
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

    /**
     * Ajoute ou retire une réaction
     */
    async toggle(postId, reactionTypeId) {
        const sessionToken = SessionManager.getToken();
        if (!sessionToken) {
            await SessionManager.getOrCreateSession();
        }

        // Vérifier si l'utilisateur a déjà réagi
        const { data: existing } = await supabaseClient
            .from('post_reactions')
            .select('*')
            .eq('post_id', postId)
            .eq('reaction_type_id', reactionTypeId)
            .eq('session_token', SessionManager.getToken())
            .single();

        if (existing) {
            // Retirer la réaction
            const { error } = await supabaseClient
                .from('post_reactions')
                .delete()
                .eq('id', existing.id);

            return { action: 'removed', success: !error };
        } else {
            // Ajouter la réaction
            const { error } = await supabaseClient
                .from('post_reactions')
                .insert({
                    post_id: postId,
                    reaction_type_id: reactionTypeId,
                    session_token: SessionManager.getToken()
                });

            return { action: 'added', success: !error };
        }
    },

    /**
     * Récupère les réactions de l'utilisateur pour un post
     */
    async getUserReactions(postId) {
        const sessionToken = SessionManager.getToken();
        if (!sessionToken) return [];

        const { data, error } = await supabaseClient
            .from('post_reactions')
            .select('reaction_type_id')
            .eq('post_id', postId)
            .eq('session_token', sessionToken);

        if (error) return [];

        return data.map(r => r.reaction_type_id);
    }
};


const CommentsAPI = {
    /**
     * Récupère les commentaires d'un post
     */
    async getForPost(postId) {
        const { data, error } = await supabaseClient
            .from('comments')
            .select(`
                *
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

    /**
     * Crée un commentaire
     */
    async create(postId, content, parentCommentId = null) {
        const sessionToken = SessionManager.getToken();
        if (!sessionToken) {
            await SessionManager.getOrCreateSession();
        }

        const { data, error } = await supabaseClient
            .from('comments')
            .insert({
                post_id: postId,
                parent_comment_id: parentCommentId,
                session_token: SessionManager.getToken(),
                content: content
            })
            .select()
            .single();

        if (error) {
            console.error('Erreur création commentaire:', error);
            return null;
        }

        return this.formatComment(data);
    },

    /**
     * Supprime un commentaire
     */
    async delete(commentId) {
        const sessionToken = SessionManager.getToken();

        const { error } = await supabaseClient
            .from('comments')
            .update({ status: 'deleted' })
            .eq('id', commentId)
            .eq('session_token', sessionToken);

        return !error;
    },

    /**
     * Like/Unlike un commentaire
     */
    async toggleLike(commentId) {
        const sessionToken = SessionManager.getToken();
        if (!sessionToken) {
            await SessionManager.getOrCreateSession();
        }

        // Vérifier si déjà liké
        const { data: existing, error: checkError } = await supabaseClient
            .from('comment_likes')
            .select('id')
            .eq('comment_id', commentId)
            .eq('session_token', SessionManager.getToken())
            .maybeSingle();

        if (existing) {
            const { error } = await supabaseClient
                .from('comment_likes')
                .delete()
                .eq('id', existing.id);

            return { action: 'unliked', success: !error };
        } else {
            const { error } = await supabaseClient
                .from('comment_likes')
                .insert({
                    comment_id: commentId,
                    session_token: SessionManager.getToken()
                });

            return { action: 'liked', success: !error };
        }
    },

    /**
     * Formate une liste de commentaires
     */
    formatComments(comments) {
        return comments.map(c => this.formatComment(c));
    },

    /**
     * Formate un commentaire
     */
    formatComment(comment) {
        const sessionToken = SessionManager.getToken();

        return {
            id: comment.id,
            postId: comment.post_id,
            parentId: comment.parent_comment_id,
            authorName: 'Anonyme',
            content: comment.content,
            createdAt: comment.created_at,
            timeAgo: PostsAPI.timeAgo(comment.created_at),
            likesCount: comment.likes_count || 0,
            isOwn: comment.session_token === sessionToken
        };
    }
};

// =====================================================
// OPÉRATIONS SUR LES BROUILLONS
// =====================================================

const DraftsAPI = {
    /**
     * Récupère le brouillon actuel
     */
    async getCurrent() {
        const sessionToken = SessionManager.getToken();
        if (!sessionToken) return null;

        const { data, error } = await supabaseClient
            .from('drafts')
            .select(`
                *,
                draft_moods (moods (id, name, emoji)),
                draft_tags (tags (id, name, slug))
            `)
            .eq('session_token', sessionToken)
            .single();

        if (error) return null;

        return {
            id: data.id,
            content: data.content,
            moods: data.draft_moods?.map(dm => dm.moods) || [],
            tags: data.draft_tags?.map(dt => dt.tags) || [],
            updatedAt: data.updated_at
        };
    },

    /**
     * Sauvegarde un brouillon
     */
    async save(content, moodIds = [], tagIds = []) {
        const sessionToken = SessionManager.getToken();
        if (!sessionToken) {
            await SessionManager.getOrCreateSession();
        }

        // Vérifier si un brouillon existe
        const existing = await this.getCurrent();

        if (existing) {
            // Mettre à jour
            await supabaseClient
                .from('drafts')
                .update({
                    content: content,
                    auto_saved_at: new Date().toISOString()
                })
                .eq('id', existing.id);

            // Mettre à jour les moods
            await supabaseClient.from('draft_moods').delete().eq('draft_id', existing.id);
            if (moodIds.length > 0) {
                await supabaseClient.from('draft_moods').insert(
                    moodIds.map(id => ({ draft_id: existing.id, mood_id: id }))
                );
            }

            // Mettre à jour les tags
            await supabaseClient.from('draft_tags').delete().eq('draft_id', existing.id);
            if (tagIds.length > 0) {
                await supabaseClient.from('draft_tags').insert(
                    tagIds.map(id => ({ draft_id: existing.id, tag_id: id }))
                );
            }

            return existing.id;
        } else {
            // Créer nouveau
            const { data, error } = await supabaseClient
                .from('drafts')
                .insert({
                    session_token: SessionManager.getToken(),
                    content: content
                })
                .select()
                .single();

            if (error || !data) return null;

            // Ajouter moods et tags
            if (moodIds.length > 0) {
                await supabaseClient.from('draft_moods').insert(
                    moodIds.map(id => ({ draft_id: data.id, mood_id: id }))
                );
            }
            if (tagIds.length > 0) {
                await supabaseClient.from('draft_tags').insert(
                    tagIds.map(id => ({ draft_id: data.id, tag_id: id }))
                );
            }

            return data.id;
        }
    },

    /**
     * Supprime le brouillon
     */
    async delete() {
        const sessionToken = SessionManager.getToken();
        if (!sessionToken) return;

        await supabaseClient
            .from('drafts')
            .delete()
            .eq('session_token', sessionToken);
    }
};

// =====================================================
// STATISTIQUES
// =====================================================

const StatsAPI = {
    /**
     * Récupère les statistiques globales
     */
    async getGlobal() {
        // Compter les posts
        const { count: postsCount } = await supabaseClient
            .from('posts')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'published');

        // Compter les sessions actives ce mois
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { count: activeSessions } = await supabaseClient
            .from('anonymous_sessions')
            .select('*', { count: 'exact', head: true })
            .gte('last_activity_at', thirtyDaysAgo.toISOString());

        return {
            postsCount: postsCount || 0,
            activeSessions: activeSessions || 0,
            anonymousPercent: 100
        };
    },

    /**
     * Récupère les stats de l'utilisateur
     */
    async getMyStats() {
        const sessionToken = SessionManager.getToken();
        if (!sessionToken) return { postsCount: 0, reactionsCount: 0, viewsCount: 0 };

        const { data: posts } = await supabaseClient
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
// HUMEURS (MOODS)
// =====================================================

const MoodsAPI = {
    /**
     * Récupère toutes les humeurs actives
     */
    async getAll() {
        const { data, error } = await supabaseClient
            .from('moods')
            .select('*')
            .eq('is_active', true)
            .order('sort_order');

        if (error) {
            console.error('Erreur récupération moods:', error);
            return [];
        }

        return data;
    }
};

// =====================================================
// TAGS
// =====================================================

const TagsAPI = {
    /**
     * Récupère les tags populaires
     */
    async getPopular(limit = 20) {
        const { data, error } = await supabaseClient
            .from('tags')
            .select('*')
            .order('usage_count', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Erreur récupération tags:', error);
            return [];
        }

        return data;
    }
};

// =====================================================
// INITIALISATION
// =====================================================

// Initialiser la session au chargement
document.addEventListener('DOMContentLoaded', async () => {
    // S'assurer que Supabase est initialisé
    if (!supabaseClient) {
        initSupabase();
    }
    await SessionManager.getOrCreateSession();
    console.log('Mia Darling - Session initialisée');
});

// Exporter les APIs immédiatement
window.MiaDarling = {
    SessionManager,
    PostsAPI,
    ReactionsAPI,
    CommentsAPI,
    DraftsAPI,
    StatsAPI,
    MoodsAPI,
    TagsAPI,
    getSupabase: () => supabaseClient
};

console.log('Mia Darling - Module chargé');
