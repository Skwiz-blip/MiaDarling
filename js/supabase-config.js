const SUPABASE_URL = 'https://yeawjdkyqjyjvpahlbmp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllYXdqZGt5cWp5anZwYWhsYm1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NzQ2MzAsImV4cCI6MjA5MjI1MDYzMH0.DP3kRbQ0UH7moDkaF61y9wmlqupLXjClj6PSqROQNlA';

// Initialisation du client Supabase
let supabaseClient = null;

function initSupabase() {
    if (window.supabase && window.supabase.createClient) {
        // Session Google persistante + rafraîchie automatiquement :
        // l'utilisateur reste connecté entre les visites et appareils.
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storageKey: 'mia_darling_auth'
            }
        });
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
                .maybeSingle();

            if (data && !data.is_banned) {
                await supabaseClient
                    .from('anonymous_sessions')
                    .update({ last_activity_at: new Date().toISOString() })
                    .eq('session_token', sessionToken);

                return { sessionToken, session: data };
            }
            // On ne jette le token QUE s'il est vraiment invalide (introuvable ou
            // banni), jamais sur une erreur réseau transitoire — pour éviter de
            // déconnecter l'utilisateur pour rien.
            if (!error && !data) {
                localStorage.removeItem(this.STORAGE_KEY);
                sessionToken = null;
            }
            else if (data && data.is_banned) {
                localStorage.removeItem(this.STORAGE_KEY);
                return { sessionToken: null, session: data, banned: true };
            }
        }

        // 2) Une session Supabase Auth (Google) est-elle active ?
        // (Persistée + rafraîchie : retrouve l'identité liée au compte Google,
        //  même après un vidage du token local ou un changement d'appareil.)
        const { data: { session: authSession } } = await supabaseClient.auth.getSession();
        if (authSession && authSession.user) {
            return await this.bindAuthUser(authSession.user);
        }

        // 3) Token encore en cache mais vérif impossible (réseau) → on le garde
        //    de façon optimiste plutôt que de déconnecter l'utilisateur.
        if (sessionToken) {
            return { sessionToken, session: { anonymous_name: 'Anonyme', is_banned: false } };
        }

        // 4) Vraiment pas connecté → pas de session
        return null;
    },

    /**
     * Lie le compte Google à une identité anonyme (la retrouve ou la crée).
     * L'email/nom réels sont stockés dans user_identities (table protégée),
     * jamais dans anonymous_sessions qui reste public et 100% anonyme.
     */
    async bindAuthUser(authUser) {
        const meta = authUser.user_metadata || {};

        // Cherche le token déjà lié à ce compte Google, de DEUX façons, pour
        // garantir la récupération même si une écriture précédente a échoué :
        //   a) via user_identities (lien principal)
        //   b) via anonymous_sessions.auth_user_id (filet de secours)
        let token = null;

        const { data: identity } = await supabaseClient
            .from('user_identities')
            .select('session_token')
            .eq('auth_user_id', authUser.id)
            .maybeSingle();
        if (identity && identity.session_token) token = identity.session_token;

        if (!token) {
            const { data: boundSession } = await supabaseClient
                .from('anonymous_sessions')
                .select('session_token')
                .eq('auth_user_id', authUser.id)
                .maybeSingle();
            if (boundSession && boundSession.session_token) {
                token = boundSession.session_token;
                // Ré-enregistre le lien privé manquant (backfill)
                await this.upsertIdentity(authUser, token, meta);
            }
        }

        // Identité retrouvée → on réutilise le MÊME token (mêmes données)
        if (token) {
            const { data: sess } = await supabaseClient
                .from('anonymous_sessions')
                .select('*')
                .eq('session_token', token)
                .maybeSingle();

            if (sess && sess.is_banned) return { sessionToken: null, session: sess, banned: true };

            // Garde l'email/nom à jour côté admin, sans rien changer côté public
            await this.upsertIdentity(authUser, token, meta);
            await supabaseClient
                .from('anonymous_sessions')
                .update({ last_activity_at: new Date().toISOString() })
                .eq('session_token', token);

            localStorage.setItem(this.STORAGE_KEY, token);
            return { sessionToken: token, session: sess };
        }

        // Première connexion : on crée l'identité anonyme + le lien privé
        const newToken = this.generateToken();
        const anonymousName = this.generateAnonymousName();

        const { data: sess, error: sessErr } = await supabaseClient
            .from('anonymous_sessions')
            .insert({
                session_token: newToken,
                anonymous_name: anonymousName,
                auth_user_id: authUser.id
            })
            .select()
            .single();

        if (sessErr) {
            // Course possible : une session pour ce compte vient d'être créée
            // ailleurs. On la récupère plutôt que d'en créer une seconde.
            const { data: raced } = await supabaseClient
                .from('anonymous_sessions')
                .select('*')
                .eq('auth_user_id', authUser.id)
                .maybeSingle();
            if (raced && raced.session_token) {
                await this.upsertIdentity(authUser, raced.session_token, meta);
                localStorage.setItem(this.STORAGE_KEY, raced.session_token);
                return { sessionToken: raced.session_token, session: raced };
            }
            console.error('Erreur création session:', sessErr);
            return null;
        }

        await this.upsertIdentity(authUser, newToken, meta);

        localStorage.setItem(this.STORAGE_KEY, newToken);
        return { sessionToken: newToken, session: sess };
    },

    /**
     * Écrit/maj le lien privé (auth_user_id ↔ session_token) + email/nom réels.
     * Idempotent (upsert) : sûr à appeler à chaque connexion.
     */
    async upsertIdentity(authUser, sessionToken, meta) {
        meta = meta || authUser.user_metadata || {};
        const { error } = await supabaseClient
            .from('user_identities')
            .upsert({
                auth_user_id: authUser.id,
                session_token: sessionToken,
                real_email: authUser.email || null,
                real_name: meta.full_name || meta.name || null,
                avatar_url: meta.avatar_url || meta.picture || null,
                updated_at: new Date().toISOString()
            }, { onConflict: 'auth_user_id' });
        if (error) console.error('Erreur enregistrement identité:', error);
    },

    /**
     * Démarre la connexion Google (OAuth Supabase).
     * redirectTo = page de retour après Google (par défaut welcome.html).
     */
    async signInWithGoogle(redirectTo) {
        return supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectTo || (window.location.origin + '/welcome.html')
            }
        });
    },

    /**
     * Déconnexion : ferme la session Google et oublie le token local.
     */
    async signOut() {
        try { await supabaseClient.auth.signOut(); } catch (e) { /* noop */ }
        localStorage.removeItem(this.STORAGE_KEY);
        localStorage.removeItem('mia_darling_recovery');
    },

    /**
     * Garde-fou de page : renvoie la session ou redirige vers welcome.html.
     */
    async requireSession() {
        const result = await this.getOrCreateSession();
        if (!result || !result.sessionToken) {
            window.location.href = 'welcome.html';
            return null;
        }
        return result;
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

    async getSession() {
        const token = this.getToken();
        if (!token) return null;

        const { data, error } = await supabaseClient
            .from('anonymous_sessions')
            .select('*')
            .eq('session_token', token)
            .single();

        return error ? null : data;
    },

    async getSessionInfo() {
        return this.getSession();
    }
};

const PostsAPI = {
    async getRecent(limit = 20, offset = 0) {
        const { data, error } = await supabaseClient
            .from('posts')
            .select('*')
            .eq('status', 'published')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            console.error('Erreur récupération posts:', error);
            return [];
        }

        // Récupérer les noms anonymes
        const posts = await this.enrichWithAnonymousNames(data);
        return posts;
    },

    async getPopular(limit = 20) {
        const { data, error } = await supabaseClient
            .from('posts')
            .select('*')
            .eq('status', 'published')
            .order('reactions_count', { ascending: false })
            .order('views_count', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Erreur récupération posts populaires:', error);
            return [];
        }

        const posts = await this.enrichWithAnonymousNames(data);
        return posts;
    },

    async getById(postId) {
        const { data, error } = await supabaseClient
            .from('posts')
            .select('*')
            .eq('id', postId)
            .single();

        if (error) {
            console.error('Erreur récupération post:', error);
            return null;
        }

        const posts = await this.enrichWithAnonymousNames([data]);
        return posts[0];
    },

    async enrichWithAnonymousNames(posts) {
        if (!posts || posts.length === 0) return [];

        // Extraire les session_tokens uniques
        const tokens = [...new Set(posts.map(p => p.session_token).filter(Boolean))];

        if (tokens.length === 0) {
            return posts.map(p => this.formatPost(p, 'Anonyme'));
        }

        // Récupérer les sessions correspondantes
        const { data: sessions } = await supabaseClient
            .from('anonymous_sessions')
            .select('session_token, anonymous_name')
            .in('session_token', tokens);

        // Créer un map token -> name
        const nameMap = {};
        (sessions || []).forEach(s => {
            nameMap[s.session_token] = s.anonymous_name;
        });

        // Formater les posts avec les noms
        return posts.map(p => this.formatPost(p, nameMap[p.session_token] || 'Anonyme'));
    },

    async getMyPosts() {
        const sessionToken = SessionManager.getToken();
        if (!sessionToken) return [];

        const { data, error } = await supabaseClient
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
            .single();

        if (!existing) {
            // Enregistrer la vue
            await supabaseClient.from('post_views').insert({
                post_id: postId,
                session_token: SessionManager.getToken()
            });

            // Incrémenter le compteur de vues
            await supabaseClient.rpc('increment_view_count', { post_id: postId });
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
    formatPost(post, anonymousName = 'Anonyme') {
        return {
            id: post.id,
            content: post.content,
            authorName: anonymousName,
            createdAt: post.created_at,
            timeAgo: this.timeAgo(post.created_at),
            isEdited: post.is_edited,
            viewsCount: post.views_count || 0,
            commentsCount: post.comments_count || 0,
            reactionsCount: post.reactions_count || 0,
            moods: [],
            tags: []
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
        const { data: existing, error: queryError } = await supabaseClient
            .from('post_reactions')
            .select('*')
            .eq('post_id', postId)
            .eq('reaction_type_id', reactionTypeId)
            .eq('session_token', SessionManager.getToken())
            .maybeSingle();

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
            .select('*')
            .eq('post_id', postId)
            .eq('status', 'visible')
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Erreur récupération commentaires:', error);
            return [];
        }

        const comments = await this.enrichWithAnonymousNames(data);
        return comments;
    },

    async enrichWithAnonymousNames(comments) {
        if (!comments || comments.length === 0) return [];

        // Extraire les session_tokens uniques
        const tokens = [...new Set(comments.map(c => c.session_token).filter(Boolean))];

        if (tokens.length === 0) {
            return comments.map(c => this.formatComment(c, 'Anonyme'));
        }

        // Récupérer les sessions correspondantes
        const { data: sessions } = await supabaseClient
            .from('anonymous_sessions')
            .select('session_token, anonymous_name')
            .in('session_token', tokens);

        // Créer un map token -> name
        const nameMap = {};
        (sessions || []).forEach(s => {
            nameMap[s.session_token] = s.anonymous_name;
        });

        // Formater les commentaires avec les noms
        return comments.map(c => this.formatComment(c, nameMap[c.session_token] || 'Anonyme'));
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

        // Récupérer le nom de la session actuelle
        const session = await SessionManager.getSession();
        const anonymousName = session?.anonymous_name || 'Anonyme';
        return this.formatComment(data, anonymousName);
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
    formatComment(comment, anonymousName = 'Anonyme') {
        const sessionToken = SessionManager.getToken();

        return {
            id: comment.id,
            postId: comment.post_id,
            parentId: comment.parent_comment_id,
            authorName: anonymousName,
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
            .maybeSingle();

        if (error || !data) return null;

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
// GROUPS
// =====================================================

const GroupsAPI = {
    /**
     * Récupère tous les groupes actifs
     */
    async getAll() {
        const { data, error } = await supabaseClient
            .from('groups')
            .select('*')
            .eq('status', 'active')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Erreur récupération groupes:', error);
            return [];
        }

        // Compter les membres réels par groupe (la colonne members_count n'est pas maintenue)
        const { data: memberRows } = await supabaseClient
            .from('group_members')
            .select('group_id');
        const memberCounts = {};
        (memberRows || []).forEach(r => {
            memberCounts[r.group_id] = (memberCounts[r.group_id] || 0) + 1;
        });

        const { data: messageRows } = await supabaseClient
            .from('group_messages')
            .select('group_id, created_at')
            .eq('status', 'visible')
            .order('created_at', { ascending: false });

        const latestActivityByGroup = {};
        (messageRows || []).forEach(message => {
            if (!latestActivityByGroup[message.group_id]) {
                latestActivityByGroup[message.group_id] = message.created_at;
            }
        });

        // Formater les données pour le frontend
        return data.map(g => ({
            id: g.id,
            name: g.name,
            description: g.description,
            membersCount: memberCounts[g.id] ?? (g.members_count || 0),
            messagesCount: g.messages_count || 0,
            createdAt: g.created_at,
            lastActivityAt: latestActivityByGroup[g.id] || g.created_at,
            status: g.status
        }));
    },

    /**
     * Récupère un groupe par ID
     */
    async getById(groupId) {
        const { data, error } = await supabaseClient
            .from('groups')
            .select('*')
            .eq('id', groupId)
            .single();

        if (error) {
            console.error('Erreur récupération groupe:', error);
            return null;
        }

        // Compter les membres réels (la colonne members_count n'est pas maintenue)
        const { count: realMembersCount } = await supabaseClient
            .from('group_members')
            .select('*', { count: 'exact', head: true })
            .eq('group_id', groupId);

        // Formater les données pour le frontend
        const { data: latestMessageRow } = await supabaseClient
            .from('group_messages')
            .select('created_at')
            .eq('group_id', groupId)
            .eq('status', 'visible')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        return {
            id: data.id,
            name: data.name,
            description: data.description,
            membersCount: realMembersCount ?? (data.members_count || 0),
            messagesCount: data.messages_count || 0,
            createdAt: data.created_at,
            lastActivityAt: latestMessageRow?.created_at || data.created_at,
            status: data.status
        };
    },

    /**
     * Crée un nouveau groupe (admin back-office uniquement)
     */
    async create(name, description = '') {
        // Vérifier que l'utilisateur est admin
        const isAdmin = await this.isAdmin();
        if (!isAdmin) {
            console.error('Seul un admin back-office peut créer des groupes');
            return null;
        }

        const sessionToken = SessionManager.getToken();
        if (!sessionToken) return null;

        const { data, error } = await supabaseClient
            .from('groups')
            .insert({
                name: name,
                description: description,
                created_by: sessionToken
            })
            .select()
            .single();

        if (error) {
            console.error('Erreur création groupe:', error);
            return null;
        }

        return data;
    },

    /**
     * Rejoint un groupe
     */
    async join(groupId) {
        const sessionToken = SessionManager.getToken();
        if (!sessionToken) return false;

        // Vérifier si déjà membre
        const { data: existing } = await supabaseClient
            .from('group_members')
            .select('*')
            .eq('group_id', groupId)
            .eq('session_token', sessionToken)
            .maybeSingle();

        if (existing) return true;

        // Ajouter comme membre
        const { error } = await supabaseClient
            .from('group_members')
            .insert({
                group_id: groupId,
                session_token: sessionToken
            });

        return !error;
    },

    /**
     * Quitte un groupe
     */
    async leave(groupId) {
        const sessionToken = SessionManager.getToken();
        if (!sessionToken) return false;

        const { error } = await supabaseClient
            .from('group_members')
            .delete()
            .eq('group_id', groupId)
            .eq('session_token', sessionToken);

        return !error;
    },

    /**
     * Récupère les messages d'un groupe
     */
    async getMessages(groupId, limit = 50) {
        const { data, error } = await supabaseClient
            .from('group_messages')
            .select('*')
            .eq('group_id', groupId)
            .eq('status', 'visible')
            .order('created_at', { ascending: true })
            .limit(limit);

        if (error) {
            console.error('Erreur récupération messages:', error);
            return [];
        }

        // Enrichir avec les noms d'auteurs
        const enriched = await this.enrichWithAnonymousNames(data);

        // Formater pour le frontend
        return enriched.map(m => ({
            id: m.id,
            groupId: m.group_id,
            content: m.content,
            sessionToken: m.session_token,
            authorName: m.authorName || 'Anonyme',
            isAdminReply: m.is_admin_reply || false,
            createdAt: m.created_at
        }));
    },

    /**
     * Envoie un message dans un groupe
     */
    async sendMessage(groupId, content) {
        const sessionToken = SessionManager.getToken();
        if (!sessionToken) return null;

        const { data, error } = await supabaseClient
            .from('group_messages')
            .insert({
                group_id: groupId,
                session_token: sessionToken,
                content: content
            })
            .select()
            .single();

        if (error) {
            console.error('Erreur envoi message:', error);
            return null;
        }

        // Récupérer le nom de l'auteur
        const session = await SessionManager.getSession();
        return {
            ...data,
            authorName: session?.anonymous_name || 'Anonyme',
            sessionToken: sessionToken
        };
    },

    /**
     * Récupère les membres d'un groupe
     */
    async getMembers(groupId) {
        const { data: members, error } = await supabaseClient
            .from('group_members')
            .select('session_token, joined_at')
            .eq('group_id', groupId)
            .order('joined_at', { ascending: true });

        if (error || !members) {
            console.error('Erreur récupération membres:', error);
            return [];
        }

        // Récupérer les noms anonymes
        const tokens = members.map(m => m.session_token);
        const { data: sessions } = await supabaseClient
            .from('anonymous_sessions')
            .select('session_token, anonymous_name')
            .in('session_token', tokens);

        const nameMap = {};
        (sessions || []).forEach(s => {
            nameMap[s.session_token] = s.anonymous_name;
        });

        return members.map(m => ({
            sessionToken: m.session_token,
            anonymousName: nameMap[m.session_token] || 'Anonyme',
            joinedAt: m.joined_at
        }));
    },

    /**
     * Supprime un message (admin ou auteur)
     */
    async deleteMessage(messageId) {
        const sessionToken = SessionManager.getToken();

        const { error } = await supabaseClient
            .from('group_messages')
            .update({ status: 'deleted' })
            .eq('id', messageId)
            .eq('session_token', sessionToken);

        return !error;
    },

    /**
     * Enrichit les messages avec les noms anonymes
     */
    async enrichWithAnonymousNames(messages) {
        if (!messages || messages.length === 0) return [];

        const tokens = [...new Set(messages.map(m => m.session_token).filter(Boolean))];

        if (tokens.length === 0) {
            return messages.map(m => ({ ...m, authorName: 'Anonyme' }));
        }

        const { data: sessions } = await supabaseClient
            .from('anonymous_sessions')
            .select('session_token, anonymous_name')
            .in('session_token', tokens);

        const nameMap = {};
        (sessions || []).forEach(s => {
            nameMap[s.session_token] = s.anonymous_name;
        });

        return messages.map(m => ({
            ...m,
            authorName: nameMap[m.session_token] || 'Anonyme'
        }));
    },

    /**
     * Vérifie si l'utilisateur est admin back-office
     */
    async isAdmin() {
        const sessionToken = SessionManager.getToken();
        if (!sessionToken) return false;

        const { data } = await supabaseClient
            .from('admin_users')
            .select('id')
            .eq('session_token', sessionToken)
            .eq('is_active', true)
            .maybeSingle();

        return !!data;
    },

    /**
     * Admin: Supprime un groupe
     */
    async adminDeleteGroup(groupId) {
        const isAdmin = await this.isAdmin();
        if (!isAdmin) return false;

        const { error } = await supabaseClient
            .from('groups')
            .update({ is_active: false })
            .eq('id', groupId);

        return !error;
    },

    /**
     * Admin: Bannit un membre d'un groupe
     */
    async adminBanMember(groupId, sessionToken) {
        const isAdmin = await this.isAdmin();
        if (!isAdmin) return false;

        const { error } = await supabaseClient
            .from('group_members')
            .delete()
            .eq('group_id', groupId)
            .eq('session_token', sessionToken);

        return !error;
    },

    /**
     * Admin: Supprime n'importe quel message
     */
    async adminDeleteMessage(messageId) {
        const isAdmin = await this.isAdmin();
        if (!isAdmin) return false;

        const { error } = await supabaseClient
            .from('group_messages')
            .update({ status: 'deleted' })
            .eq('id', messageId);

        return !error;
    }
};

// =====================================================
// INITIALISATION
// =====================================================

// Initialiser uniquement le client au chargement.
// La session n'est plus créée automatiquement : chaque page appelle
// SessionManager.requireSession() (ou getOrCreateSession) elle-même, ce qui
// évite de créer une identité avant la connexion Google.
document.addEventListener('DOMContentLoaded', () => {
    if (!supabaseClient) {
        initSupabase();
    }
    console.log('Mia Darling - Client initialisé');
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
    GroupsAPI,
    getSupabase: () => supabaseClient
};

console.log('Mia Darling - Module chargé');
