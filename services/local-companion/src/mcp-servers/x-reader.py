# /// script
# requires-python = ">=3.10"
# dependencies = ["twscrape==0.20.1"]
#
# [tool.uv]
# exclude-newer = "2026-10-16T00:00:00Z"
# ///
"""
X Reader: an MCP server that reads X as the user, through the session their browser is signed in to x.com with.

Willow's companion starts it in the desktop app (`../mcp-programs.mjs`, as `uv run --script`) with that session's two
cookies in X_COOKIES ("auth_token=...; ct0=..."), and speaks MCP's stdio transport with it: JSON-RPC, one message per
line. It reads through twscrape, which asks X's web API what x.com itself asks. No tool posts, replies, likes,
reposts, follows, bookmarks or sends anything.

twscrape is pinned, and `exclude-newer` holds everything it pulls in to what was published by then, so the code that
holds the user's session is the code that was read. Move the two together.
"""

from __future__ import annotations

import asyncio
import html
import json
import os
import re
import shutil
import signal
import sys
import tempfile
import threading
import time
import traceback
from contextlib import aclosing, suppress
from datetime import datetime, timezone
from urllib.parse import quote

# Only messages go to the output. Anything a library prints goes where the companion keeps what went wrong.
OUT = sys.stdout.buffer
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
sys.stdout = sys.stderr

# twscrape counts its requests for its author's analytics. As a library it never sends them; these say not to.
os.environ["TWS_TELEMETRY"] = "0"
os.environ["DO_NOT_TRACK"] = "1"
os.environ.setdefault("TWS_LOG_LEVEL", "WARNING")

import httpx  # noqa: E402
from loguru import logger  # noqa: E402
from twscrape import API, AccountsPool, NoAccountError  # noqa: E402
from twscrape import models as twscrape_models  # noqa: E402
from twscrape.http import HttpError  # noqa: E402
from twscrape.queue_client import GqlFeaturesOutdatedError, XClIdGenStore  # noqa: E402
from twscrape.xclid import XClIdAccountError, XClIdParseError  # noqa: E402

VERSION = "1.0.0"
PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
ACCOUNT = "willow"
FOLDER_PREFIX = "willow-x-reader-"
# Willow waits a minute for a tool; one cut short says so before then.
CALL_SECONDS = 50
# A folder another X Reader left, ended before it could remove it. A live one touches its own every hour.
STALE_SECONDS = 24 * 3600

INSTRUCTIONS = (
    "Reads X as the user's own account, through the session they connected: searches, posts, replies, threads, "
    "profiles, followers, lists, bookmarks and trends. Read only: it cannot post, reply, like, repost, follow or send "
    "messages. Every request counts against what X allows the account, so ask for what the question needs."
)
SESSION_ENDED = (
    "X turned this session down: it has been logged out, or X has locked or limited the account. Sign in to x.com "
    "again, copy fresh auth_token and ct0 cookies, then disconnect X Reader in Willow and connect it again with them."
)
OUTDATED = (
    "X changed its web app in a way this X Reader cannot follow. It needs a newer twscrape, which comes with an "
    "update to Willow."
)
# What X limits, by twscrape's name for the request.
LIMITED = {
    "SearchTimeline": "searches",
    "UserByScreenName": "looking up accounts",
    "UserTweets": "reading accounts' posts",
    "UserTweetsAndReplies": "reading accounts' posts",
    "TweetDetail": "reading posts, replies and threads",
    "Followers": "follower lists",
    "Following": "following lists",
    "GenericTimelineById": "trends",
    "ListLatestTweetsTimeline": "lists",
    "Bookmarks": "bookmarks",
}


def _dump_unparsed(kind, error, item, obj):
    logger.error(f"X Reader could not read a {kind} X sent: {type(error).__name__}: {error}")


# twscrape writes an answer it cannot parse to /tmp (C:\tmp on Windows); it is said on stderr instead.
twscrape_models._write_dump = _dump_unparsed


class ToolError(Exception):
    """A call that cannot be answered, in words for the model to pass on."""


# --- What the user's tools are given --------------------------------------------------------------------------------

HANDLE = re.compile(r"[A-Za-z0-9_]{1,50}")
PROFILE_LINK = re.compile(r"^(?:https?://)?(?:www\.|mobile\.)?(?:x|twitter)\.com/@?([A-Za-z0-9_]{1,50})(?:[/?#].*)?$", re.I)
NOT_HANDLES = {"home", "explore", "search", "notifications", "messages", "i", "settings", "hashtag", "compose", "intent", "share"}


def handle_of(value) -> str:
    text = str(value or "").strip()
    link = PROFILE_LINK.match(text)
    name = (link.group(1) if link else text).lstrip("@")
    if not HANDLE.fullmatch(name) or name.lower() in NOT_HANDLES:
        raise ToolError("Give the account's handle, such as @XDevelopers, or a link to its profile.")
    return name


def post_id_of(value) -> int:
    text = str(value or "").strip()
    if re.fullmatch(r"\d{1,25}", text):
        return int(text)
    found = re.search(r"/status(?:es)?/(\d{1,25})", text)
    if not found:
        raise ToolError("Give the post's link, such as https://x.com/XDevelopers/status/1234567890, or its id.")
    return int(found.group(1))


def list_id_of(value) -> int:
    text = str(value or "").strip()
    if re.fullmatch(r"\d{1,25}", text):
        return int(text)
    found = re.search(r"/lists/(\d{1,25})", text)
    if not found:
        raise ToolError("Give the list's link, such as https://x.com/i/lists/1234567890, or its id.")
    return int(found.group(1))


def required(args: dict, name: str, problem: str) -> str:
    value = args.get(name)
    text = value.strip() if isinstance(value, str) else ""
    if not text:
        raise ToolError(problem)
    return text[:500]


def choice(args: dict, name: str, options: tuple[str, ...]) -> str:
    value = str(args.get(name) or options[0]).strip().lower()
    if value not in options:
        raise ToolError(f"{name} is one of: {', '.join(options)}.")
    return value


def limit_of(args: dict, default: int, most: int) -> int:
    value = args.get("limit")
    if value is None or value == "":
        return default
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        raise ToolError(f"limit is a number from 1 to {most}.") from None
    return max(1, min(most, number))


def flag(args: dict, name: str) -> bool:
    return args.get(name) in (True, "true", "True", 1, "1")


async def take(items, limit: int, keep=lambda item: True) -> list:
    """The first `limit` of a twscrape stream that `keep` accepts, closing the stream so it asks X for no more."""
    found = []
    async with aclosing(items) as stream:
        async for item in stream:
            if keep(item):
                found.append(item)
                if len(found) >= limit:
                    break
    return found


# --- What they get back ---------------------------------------------------------------------------------------------


def when(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def clip(text: str, most: int) -> str:
    return text if len(text) <= most else f"{text[: most - 1].rstrip()}…"


def tally(pairs) -> str:
    return " · ".join(f"{count:,} {word}" for count, word in pairs if count is not None)


def post_text(post) -> str:
    text = html.unescape(post.rawContent or "")
    for link in post.links:
        if link.tcourl and link.url:
            text = text.replace(link.tcourl, link.url)
    return text.strip()


def media_lines(post) -> list[str]:
    lines = [f"Photo: {photo.url}" for photo in post.media.photos]
    for video in post.media.videos:
        mp4 = max((variant for variant in video.variants if variant.contentType == "video/mp4"), key=lambda variant: variant.bitrate or 0, default=None)
        length = f" ({video.duration // 60_000}:{video.duration // 1_000 % 60:02d})" if video.duration else ""
        lines.append(f"Video{length}: {mp4.url if mp4 else video.thumbnailUrl}")
    lines.extend(f"GIF: {gif.videoUrl or gif.thumbnailUrl}" for gif in post.media.animated)
    return lines


def card_line(card) -> str | None:
    kind = getattr(card, "_type", "")
    if kind == "poll":
        total = sum(option.votesCount for option in card.options)
        options = "; ".join(
            f"{option.label}: {option.votesCount:,}" + (f" ({round(100 * option.votesCount / total)}%)" if total else "")
            for option in card.options
        )
        return f"Poll{' (closed)' if card.finished else ''}: {options}"
    if kind == "summary":
        return f"Link card: {card.title} — {card.url}"
    if kind == "broadcast":
        return f"Broadcast: {card.title} — {card.url}"
    if kind == "audiospace":
        return f"Space: {card.url}"
    return None


def post_lines(post, most: int = 1_500, quoted: bool = False) -> list[str]:
    if post.retweetedTweet is not None:
        return [f"@{post.user.username} reposted this {when(post.date)}:", *post_lines(post.retweetedTweet, most, quoted)]
    lines = [f"@{post.user.username} ({post.user.displayname}) · {when(post.date)} · {post.url}"]
    if post.inReplyToTweetIdStr and not quoted:
        to = f"@{post.inReplyToUser.username}" if post.inReplyToUser else "a post"
        lines.append(f"Replying to {to}: https://x.com/i/status/{post.inReplyToTweetIdStr}")
    lines.append(clip(post_text(post), most))
    lines.extend(media_lines(post))
    card = card_line(post.card)
    if card:
        lines.append(card)
    if post.quotedTweet is not None and not quoted:
        lines.append("Quoting:")
        lines.extend(f"  {line}" for line in post_lines(post.quotedTweet, 600, quoted=True))
    if not quoted:
        lines.append(tally((
            (post.replyCount, "replies"),
            (post.retweetCount, "reposts"),
            (post.quoteCount, "quotes"),
            (post.likeCount, "likes"),
            (post.bookmarkedCount, "bookmarks"),
            (post.viewCount, "views"),
        )))
    return lines


def posts_text(posts, most: int = 1_500) -> str:
    return "\n\n".join("\n".join(post_lines(post, most)) for post in posts)


def unquoted(posts: list) -> list:
    """Without the posts X sends only as what others in the same answer quote."""
    quoted = {post.quotedTweet.id for post in posts if post.quotedTweet is not None}
    return [post for post in posts if post.id not in quoted]


def account_line(user) -> str:
    bio = clip(" ".join(html.unescape(user.rawDescription or "").split()), 160)
    return f"{user.displayname} (@{user.username}) · {user.followersCount:,} followers" + (f" · {bio}" if bio else "")


def accounts_text(users) -> str:
    return "\n".join(account_line(user) for user in users)


def profile_text(user) -> str:
    lines = [f"{user.displayname} (@{user.username}) · {user.url}"]
    marks = []
    if user.blue or user.verified:
        marks.append(f"Verified ({user.blueType.lower()})" if user.blueType else "Verified")
    if user.protected:
        marks.append("Protected: only accounts it approves see its posts")
    if marks:
        lines.append(" · ".join(marks))
    bio = html.unescape(user.rawDescription or "").strip()
    if bio:
        lines.append(f"Bio: {bio}")
    if user.location:
        lines.append(f"Location: {user.location}")
    lines.extend(f"Link: {link.url}" for link in user.descriptionLinks if link.url)
    lines.append(f"Joined {user.created:%B %Y} ({user.created:%Y-%m-%d})")
    lines.append(tally((
        (user.followersCount, "followers"),
        (user.friendsCount, "following"),
        (user.statusesCount, "posts"),
        (user.favouritesCount, "likes"),
        (user.mediaCount, "photos and videos"),
        (user.listedCount, "lists it is on"),
    )))
    lines.extend(f"Pinned post: https://x.com/{user.username}/status/{pinned}" for pinned in user.pinnedIds)
    return "\n".join(lines)


def trends_text(trends) -> str:
    lines = []
    for place, trend in enumerate(trends, 1):
        meta = trend.trend_metadata
        about = " · ".join(part for part in (getattr(meta, "domain_context", None), getattr(meta, "meta_description", None)) if part)
        lines.append(f"{place}. {trend.name}{f' — {about}' if about else ''} · https://x.com/search?q={quote(trend.name)}")
    return "\n".join(lines)


# --- The tools ------------------------------------------------------------------------------------------------------


class Reader:
    """The tools, over one twscrape account made of the user's cookies. Calls run one at a time (`Server`)."""

    def __init__(self, api: API, pool: AccountsPool, cookies: dict[str, str]):
        self.api = api
        self.pool = pool
        self.cookies = cookies
        self.checked = False
        self.refused: str | None = None
        # What twscrape warned of during the call: how a refusal it swallowed is told from finding nothing.
        self.notes: list[str] = []
        logger.add(self.note, level="WARNING", format="{message}")

    def note(self, message) -> None:
        self.notes = [*self.notes[-19:], message.record["message"]]

    async def call(self, name: str, args: dict) -> tuple[str, bool]:
        self.notes = []
        try:
            await self.check_session()
            return await TOOL_RUNS[name](self, args), False
        except ToolError as error:
            return str(error), True
        except NoAccountError as error:
            return await self.no_account(str(error)), True
        except (GqlFeaturesOutdatedError, XClIdParseError):
            return OUTDATED, True
        except (httpx.HTTPError, HttpError) as error:
            return f"X Reader could not reach x.com ({clip(str(error) or type(error).__name__, 200)}). Check this computer's connection, then ask again.", True
        except Exception as error:  # noqa: BLE001
            traceback.print_exc()
            return f"X Reader failed: {type(error).__name__}: {error}", True

    async def check_session(self) -> None:
        """
        Once, before the first request: whether x.com takes the cookies as signed in. twscrape would hold a signed-out
        session back for fifteen minutes as if it were busy; this says what it is. What it fetches is twscrape's own
        first step, kept for the requests after it.
        """
        if self.refused:
            raise ToolError(self.refused)
        if self.checked:
            return
        try:
            await XClIdGenStore.get(ACCOUNT, cookies=self.cookies)
        except XClIdAccountError:
            self.refused = SESSION_ENDED
            raise ToolError(SESSION_ENDED) from None
        self.checked = True

    def trouble(self) -> str | None:
        """What went wrong, from what twscrape warned of, when it ended a call without saying."""
        for text in reversed(self.notes):
            if any(sign in text for sign in ("Logged-out X web app", "Session expired or banned", "Ban detected", "Missing authentication cookies")):
                self.refused = SESSION_ENDED
                return SESSION_ENDED
            if "Blocked by" in text:
                return "X turned the request away before answering it, as it does when it takes reading to be automated. Wait a few minutes, then ask again."
            if "cooling account" in text:
                return "X Reader could not reach x.com. Check this computer's connection, then ask again."
            if "Unknown error" in text or "Unhandled API response code" in text:
                return "X answered in a way X Reader does not understand, so it waits fifteen minutes before asking that again."
            if "Update GQL_FEATURES" in text:
                return OUTDATED
        return None

    def nothing(self, message: str) -> str:
        """What a call that found nothing says: why X sent nothing, where it refused, else `message`."""
        trouble = self.trouble()
        if trouble:
            raise ToolError(trouble)
        return message

    async def no_account(self, message: str) -> str:
        """twscrape had no account to ask with: the session was refused, or X's limit for that request is used up."""
        trouble = self.trouble()
        if trouble:
            return trouble
        account = next((entry for entry in await self.pool.get_all() if entry.username == ACCOUNT), None)
        if account is None or not account.active:
            said = f" X said: {account.error_msg}." if account is not None and account.error_msg else ""
            self.refused = f"{SESSION_ENDED}{said}"
            return self.refused
        queue = message.rsplit(" ", 1)[-1]
        at = await self.pool.next_available_at(queue)
        until = f" until {at}, this computer's time" if at and at != "now" else " for now"
        return f"X's limit on {LIMITED.get(queue, 'this kind of request')} for this account is used up{until}. Ask again after that, or for something else."

    async def account(self, args: dict):
        handle = handle_of(args.get("username"))
        user = await self.api.user_by_login(handle)
        if user is None:
            raise ToolError(self.trouble() or f"X has no account @{handle}: it may be suspended, deactivated or renamed.")
        return user

    async def post(self, args: dict):
        post = await self.api.tweet_details(post_id_of(args.get("post")))
        if post is None:
            raise ToolError(self.trouble() or "X has no post with that id: it may have been deleted, or be from a protected or suspended account.")
        return post

    async def search_posts(self, args: dict) -> str:
        query = required(args, "query", "Say what to search X for.")
        sort = choice(args, "sort", ("top", "latest"))
        limit = limit_of(args, 20, 50)
        posts = await take(self.api.search(query, limit=limit, kv={"product": sort.capitalize()}), limit)
        return posts_text(unquoted(posts)) or self.nothing(f"Nothing on X matches “{query}”.")

    async def search_accounts(self, args: dict) -> str:
        query = required(args, "query", "Say what to look for: a name, a handle, or words from a bio.")
        limit = limit_of(args, 10, 50)
        users = await take(self.api.search_user(query, limit=limit), limit)
        return accounts_text(users) or self.nothing(f"No X account matches “{query}”.")

    async def get_account(self, args: dict) -> str:
        return profile_text(await self.account(args))

    async def get_account_posts(self, args: dict) -> str:
        user = await self.account(args)
        limit = limit_of(args, 20, 100)
        replies = flag(args, "replies")
        # Posts by others come in the same answer, as what its posts quote; asking for more leaves room to drop them.
        source = (self.api.user_tweets_and_replies if replies else self.api.user_tweets)(user.id, limit=limit * 2)
        posts = await take(source, limit, keep=lambda post: post.user.id == user.id)
        if posts:
            return posts_text(posts)
        if user.protected:
            return self.nothing(f"@{user.username}'s posts are protected: only accounts it approves can see them.")
        return self.nothing(f"X shows no {'posts or replies' if replies else 'posts'} from @{user.username}.")

    async def get_post(self, args: dict) -> str:
        return "\n".join(post_lines(await self.post(args), 25_000))

    async def get_replies(self, args: dict) -> str:
        post_id = post_id_of(args.get("post"))
        limit = limit_of(args, 20, 100)
        replies = await take(self.api.tweet_replies(post_id, limit=limit), limit)
        return posts_text(replies) or self.nothing("X shows no replies to that post.")

    async def get_thread(self, args: dict) -> str:
        post = await self.post(args)
        root = post.conversationId or post.id
        limit = limit_of(args, 50, 100)
        found = [post, *await take(self.api.tweet_thread(root, limit=limit * 2), limit * 2)]
        first = next((entry for entry in found if entry.id == root), post)
        author = first.user
        thread = sorted({entry.id: entry for entry in found if entry.user.id == author.id}.values(), key=lambda entry: entry.date)[:limit]
        return f"{len(thread)} {'post' if len(thread) == 1 else 'posts'} by @{author.username} in this thread, first to last:\n\n{posts_text(thread, 4_000)}"

    async def people(self, args: dict, following: bool) -> str:
        user = await self.account(args)
        limit = limit_of(args, 20, 100)
        source = (self.api.following if following else self.api.followers)(user.id, limit=limit)
        users = await take(source, limit)
        if users:
            head = (
                f"{len(users)} of the {user.friendsCount:,} accounts @{user.username} follows:"
                if following
                else f"{len(users)} of the {user.followersCount:,} accounts that follow @{user.username}:"
            )
            return f"{head}\n{accounts_text(users)}"
        if user.protected:
            return self.nothing(f"@{user.username} is protected: only accounts it approves see who it follows and who follows it.")
        return self.nothing(f"X shows no accounts {'that @' + user.username + ' follows' if following else 'that follow @' + user.username}.")

    async def get_followers(self, args: dict) -> str:
        return await self.people(args, following=False)

    async def get_following(self, args: dict) -> str:
        return await self.people(args, following=True)

    async def get_trends(self, args: dict) -> str:
        category = choice(args, "category", ("trending", "news", "sport", "entertainment"))
        trends = await take(self.api.trends(category, limit=30), 30)
        return trends_text(trends) or self.nothing("X shows no trends there right now.")

    async def get_list_posts(self, args: dict) -> str:
        list_id = list_id_of(args.get("list"))
        limit = limit_of(args, 20, 100)
        posts = await take(self.api.list_timeline(list_id, limit=limit), limit)
        return posts_text(unquoted(posts)) or self.nothing("That list has no posts X shows, or it is private and this account cannot see it.")

    async def get_bookmarks(self, args: dict) -> str:
        limit = limit_of(args, 20, 100)
        posts = await take(self.api.bookmarks(limit=limit), limit)
        return posts_text(unquoted(posts)) or self.nothing("This account has no bookmarks.")


def limit_arg(default: int, most: int) -> dict:
    return {"type": "integer", "minimum": 1, "maximum": most, "default": default, "description": f"How many to return, from 1 to {most}. {default} if left out."}


POST_ARG = {"type": "string", "description": "The post's link, such as https://x.com/XDevelopers/status/1234567890, or its id."}
ACCOUNT_ARG = {"type": "string", "description": "The account's handle, with or without the @, or a link to its profile."}


def tool(run, title: str, description: str, properties: dict, needs: tuple[str, ...] = ()) -> dict:
    return {
        "run": run,
        "spec": {
            "name": run.__name__,
            "title": title,
            "description": description,
            "inputSchema": {"type": "object", "properties": properties, "required": list(needs)},
            "annotations": {"title": title, "readOnlyHint": True, "openWorldHint": True},
        },
    }


TOOLS = [
    tool(
        Reader.search_posts,
        "Search posts",
        "Searches posts on X as X's own search does. `query` takes X's search operators: from:handle, to:handle, "
        "@handle, #tag, \"exact phrase\", OR, -word, lang:en, since:2026-01-31 and until:2026-02-28 (UTC dates), "
        "min_faves:100, min_retweets:10, filter:links, filter:media, -filter:replies. `sort` is top (X's most relevant, "
        "the default) or latest (newest first).",
        {"query": {"type": "string", "description": "What to search for, with any of X's search operators."}, "sort": {"type": "string", "enum": ["top", "latest"]}, "limit": limit_arg(20, 50)},
        ("query",),
    ),
    tool(
        Reader.search_accounts,
        "Search accounts",
        "Finds X accounts by name, handle, or what their bio says.",
        {"query": {"type": "string", "description": "A name, a handle, or words from a bio."}, "limit": limit_arg(10, 50)},
        ("query",),
    ),
    tool(
        Reader.get_account,
        "Account profile",
        "One X account's profile: its name, bio, location, links, when it joined, how many follow it and it follows, "
        "how many posts it has made, whether it is verified or protected, and its pinned post.",
        {"username": ACCOUNT_ARG},
        ("username",),
    ),
    tool(
        Reader.get_account_posts,
        "Account's posts",
        "An account's latest posts, newest first, as its profile shows them: its posts and reposts, and its replies "
        "too when `replies` is true. A pinned post may come first.",
        {"username": ACCOUNT_ARG, "replies": {"type": "boolean", "default": False, "description": "Its replies too."}, "limit": limit_arg(20, 100)},
        ("username",),
    ),
    tool(
        Reader.get_post,
        "Post",
        "One post in full: its text, author, time, counts, photos and videos, links, poll, the post it quotes, and a "
        "link to the post it replies to.",
        {"post": POST_ARG},
        ("post",),
    ),
    tool(
        Reader.get_replies,
        "Replies",
        "The replies to a post, as X ranks them under it.",
        {"post": POST_ARG, "limit": limit_arg(20, 100)},
        ("post",),
    ),
    tool(
        Reader.get_thread,
        "Thread",
        "The thread a post is part of: its author's posts in that conversation, first to last, the way a long thread "
        "reads on X. Give any post in it.",
        {"post": POST_ARG, "limit": limit_arg(50, 100)},
        ("post",),
    ),
    tool(
        Reader.get_followers,
        "Followers",
        "Accounts that follow an account, those that followed most recently first.",
        {"username": ACCOUNT_ARG, "limit": limit_arg(20, 100)},
        ("username",),
    ),
    tool(
        Reader.get_following,
        "Following",
        "Accounts an account follows, those it followed most recently first.",
        {"username": ACCOUNT_ARG, "limit": limit_arg(20, 100)},
        ("username",),
    ),
    tool(
        Reader.get_trends,
        "Trends",
        "What is trending on X now for the signed-in account's location, or in X's News, Sports or Entertainment tabs.",
        {"category": {"type": "string", "enum": ["trending", "news", "sport", "entertainment"], "description": "Which of X's trends. trending if left out."}},
    ),
    tool(
        Reader.get_list_posts,
        "List's posts",
        "The latest posts from an X list, newest first.",
        {"list": {"type": "string", "description": "The list's link, such as https://x.com/i/lists/1234567890, or its id."}, "limit": limit_arg(20, 100)},
        ("list",),
    ),
    tool(
        Reader.get_bookmarks,
        "Bookmarks",
        "The posts the signed-in account has bookmarked, the most recently bookmarked first.",
        {"limit": limit_arg(20, 100)},
    ),
]
TOOL_RUNS = {entry["spec"]["name"]: entry["run"] for entry in TOOLS}


# --- MCP over stdio -------------------------------------------------------------------------------------------------


def send(message: dict) -> None:
    # Output that has closed is a client that has gone; the input's end follows, and ends this.
    with suppress(OSError):
        OUT.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n")
        OUT.flush()


class Server:
    def __init__(self, reader: Reader, folder: str):
        self.reader = reader
        self.folder = folder
        self.calls: dict = {}
        # One account, whose limits X counts together: calls take turns, which also keeps the reading at a person's pace.
        self.turn = asyncio.Lock()

    def reply(self, request_id, result: dict) -> None:
        send({"jsonrpc": "2.0", "id": request_id, "result": result})

    def fail(self, request_id, code: int, message: str) -> None:
        send({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        inbox: asyncio.Queue = asyncio.Queue()

        def read() -> None:
            try:
                for line in sys.stdin.buffer:
                    loop.call_soon_threadsafe(inbox.put_nowait, line)
            finally:
                with suppress(RuntimeError):
                    loop.call_soon_threadsafe(inbox.put_nowait, None)

        threading.Thread(target=read, name="stdin", daemon=True).start()
        with suppress(NotImplementedError, AttributeError):
            loop.add_signal_handler(signal.SIGTERM, inbox.put_nowait, None)
        fresh = asyncio.create_task(self.keep_fresh())
        try:
            while (line := await inbox.get()) is not None:
                if line.strip():
                    self.receive(line)
        finally:
            fresh.cancel()
            for task in list(self.calls.values()):
                task.cancel()
            await asyncio.gather(fresh, *self.calls.values(), return_exceptions=True)

    async def keep_fresh(self) -> None:
        while True:
            await asyncio.sleep(3600)
            with suppress(OSError):
                os.utime(self.folder)

    def receive(self, line: bytes) -> None:
        try:
            message = json.loads(line)
        except ValueError:
            self.fail(None, -32700, "That was not JSON.")
            return
        if not isinstance(message, dict):
            self.fail(None, -32600, "A message is one JSON-RPC object.")
            return
        method = message.get("method")
        # A response: this server asks the client nothing.
        if not isinstance(method, str):
            return
        params = message.get("params") if isinstance(message.get("params"), dict) else {}
        if "id" not in message:
            cancelled = params.get("requestId")
            if method == "notifications/cancelled" and isinstance(cancelled, (str, int)) and cancelled in self.calls:
                self.calls[cancelled].cancel()
            return
        request_id = message["id"]
        if isinstance(request_id, bool) or not isinstance(request_id, (str, int)):
            self.fail(None, -32600, "A request's id is a string or a number.")
            return
        if method == "initialize":
            wanted = params.get("protocolVersion")
            self.reply(request_id, {
                "protocolVersion": wanted if wanted in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0],
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "willow-x-reader", "title": "X Reader", "version": VERSION},
                "instructions": INSTRUCTIONS,
            })
        elif method == "ping":
            self.reply(request_id, {})
        elif method == "tools/list":
            self.reply(request_id, {"tools": [entry["spec"] for entry in TOOLS]})
        elif method == "tools/call":
            name = params.get("name")
            args = params.get("arguments") if params.get("arguments") is not None else {}
            if name not in TOOL_RUNS:
                self.fail(request_id, -32602, f"X Reader has no tool called {name}.")
            elif not isinstance(args, dict):
                self.fail(request_id, -32602, "A tool's arguments are an object.")
            else:
                self.calls[request_id] = asyncio.create_task(self.call(request_id, name, args))
        else:
            self.fail(request_id, -32601, f"X Reader does not answer {method}.")

    async def call(self, request_id, name: str, args: dict) -> None:
        try:
            async with self.turn:
                text, failed = await asyncio.wait_for(self.reader.call(name, args), CALL_SECONDS)
        except asyncio.TimeoutError:
            text, failed = "X took too long to answer. Ask again, or for fewer results.", True
        except asyncio.CancelledError:
            return
        finally:
            self.calls.pop(request_id, None)
        self.reply(request_id, {"content": [{"type": "text", "text": text}], **({"isError": True} if failed else {})})


# --- Starting -------------------------------------------------------------------------------------------------------


def session_cookies() -> dict[str, str]:
    """The session's two cookies, from X_COOKIES; without both, an end that says which is missing."""
    pairs = (part.partition("=") for part in os.environ.get("X_COOKIES", "").split(";"))
    found = {name.strip(): value.strip() for name, _, value in pairs if value.strip()}
    cookies = {name: found.get(name, "") for name in ("auth_token", "ct0")}
    missing = [name for name, value in cookies.items() if not value]
    if missing:
        sys.exit(
            f"X Reader needs your x.com session's {' and '.join(missing)} {'cookie' if len(missing) == 1 else 'cookies'}. "
            "Disconnect X Reader in Willow, then connect it again with both."
        )
    return cookies


def sweep(mine: str) -> None:
    """Removes the folders of X Readers that were ended before they could, which hold a session's cookies."""
    parent = os.path.dirname(mine)
    cutoff = time.time() - STALE_SECONDS
    with suppress(OSError):
        for name in os.listdir(parent):
            folder = os.path.join(parent, name)
            if name.startswith(FOLDER_PREFIX) and folder != mine:
                with suppress(OSError):
                    if os.stat(folder).st_mtime < cutoff:
                        shutil.rmtree(folder, ignore_errors=True)


async def serve(cookies: dict[str, str]) -> None:
    # twscrape keeps its accounts in SQLite, which it opens by path, so the session lives in a folder of this run's.
    folder = tempfile.mkdtemp(prefix=FOLDER_PREFIX)
    try:
        sweep(folder)
        pool = AccountsPool(db_file=os.path.join(folder, "accounts.db"), raise_when_no_account=True)
        await pool.add_account_cookies(ACCOUNT, "; ".join(f"{name}={value}" for name, value in cookies.items()))
        await Server(Reader(API(pool), pool, cookies), folder).run()
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def main() -> None:
    cookies = session_cookies()
    with suppress(KeyboardInterrupt):
        asyncio.run(serve(cookies))


if __name__ == "__main__":
    main()
