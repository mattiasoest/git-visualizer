package app.gitvisualizer.events.support;

import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;

import app.gitvisualizer.events.client.model.Actor;
import app.gitvisualizer.events.client.model.GitHubEvent;
import app.gitvisualizer.events.client.model.RepoRef;
import app.gitvisualizer.events.dto.ActorView;
import app.gitvisualizer.events.dto.EventView;
import app.gitvisualizer.events.dto.RepoView;

@Component
public class EventMapper {

	public EventView toView(GitHubEvent event) {
		Actor actor = event.actor();
		RepoRef repo = event.repo();
		JsonNode payload = event.payload();

		return new EventView(
				event.id(),
				event.type(),
				event.createdAt(),
				actor == null ? null : new ActorView(actor.login(), actor.avatarUrl()),
				repo == null ? null : new RepoView(repo.name()),
				buildSummary(event.type(), payload),
				textOrNull(payload, "ref"),
				textOrNull(payload, "action"),
				intOrNull(payload, "number"));
	}

	private String buildSummary(String type, JsonNode payload) {
		if (type == null) {
			return "performed an action";
		}
		return switch (type) {
			case "PushEvent" -> {
				String ref = shortRef(textOrNull(payload, "ref"));
				int size = payload != null && payload.has("size") ? payload.get("size").asInt(0) : 0;
				yield size > 0 ? "pushed " + size + " commit(s) to " + ref : "pushed to " + ref;
			}
			case "PullRequestEvent" -> {
				String action = textOrNull(payload, "action");
				int number = payload != null && payload.has("number") ? payload.get("number").asInt() : 0;
				yield action + " pull request #" + number;
			}
			case "IssuesEvent" -> {
				String action = textOrNull(payload, "action");
				int number = payload != null && payload.has("issue") && payload.get("issue").has("number")
						? payload.get("issue").get("number").asInt()
						: 0;
				yield action + " issue #" + number;
			}
			case "IssueCommentEvent" -> {
				String action = textOrNull(payload, "action");
				yield action + " issue comment";
			}
			case "ForkEvent" -> "forked repository";
			case "WatchEvent" -> "starred repository";
			case "CreateEvent" -> {
				String refType = textOrNull(payload, "ref_type");
				String ref = textOrNull(payload, "ref");
				yield ref != null ? "created " + refType + " " + ref : "created " + refType;
			}
			case "DeleteEvent" -> {
				String refType = textOrNull(payload, "ref_type");
				String ref = textOrNull(payload, "ref");
				yield ref != null ? "deleted " + refType + " " + ref : "deleted " + refType;
			}
			case "ReleaseEvent" -> {
				String action = textOrNull(payload, "action");
				String tag = payload != null && payload.has("release") && payload.get("release").has("tag_name")
						? payload.get("release").get("tag_name").asText()
						: "release";
				yield action + " release " + tag;
			}
			case "CommitCommentEvent" -> textOrNull(payload, "action") + " commit comment";
			case "PullRequestReviewEvent" -> textOrNull(payload, "action") + " pull request review";
			case "PullRequestReviewCommentEvent" -> textOrNull(payload, "action") + " review comment";
			case "MemberEvent" -> textOrNull(payload, "action") + " member";
			case "PublicEvent" -> "made repository public";
			case "GollumEvent" -> "updated wiki";
			default -> type.replace("Event", "").toLowerCase() + " activity";
		};
	}

	private String shortRef(String ref) {
		if (ref == null) {
			return "branch";
		}
		return ref.replace("refs/heads/", "").replace("refs/tags/", "");
	}

	private String textOrNull(JsonNode payload, String field) {
		if (payload == null || !payload.has(field) || payload.get(field).isNull()) {
			return null;
		}
		return payload.get(field).asText();
	}

	private Integer intOrNull(JsonNode payload, String field) {
		if (payload == null || !payload.has(field) || payload.get(field).isNull()) {
			return null;
		}
		return payload.get(field).asInt();
	}
}
