package app.gitvisualizer.events.support;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import app.gitvisualizer.events.client.model.Actor;
import app.gitvisualizer.events.client.model.GitHubEvent;
import app.gitvisualizer.events.client.model.RepoRef;
import app.gitvisualizer.events.dto.EventView;

class EventMapperTest {

	private final EventMapper mapper = new EventMapper();
	private final JsonMapper objectMapper = JsonMapper.builder().build();

	@Test
	void mapsPushEventSummary() throws Exception {
		ObjectNode payload = objectMapper.createObjectNode();
		payload.put("ref", "refs/heads/main");
		payload.put("size", 3);

		GitHubEvent event = sampleEvent("PushEvent", payload);
		EventView view = mapper.toView(event);

		assertThat(view.summary()).isEqualTo("pushed 3 commit(s) to main");
		assertThat(view.ref()).isEqualTo("refs/heads/main");
	}

	@Test
	void mapsPushEventCommitMessage() throws Exception {
		ObjectNode payload = objectMapper.createObjectNode();
		payload.put("ref", "refs/heads/main");
		payload.put("head", "abc123");
		var commits = payload.putArray("commits");
		ObjectNode older = commits.addObject();
		older.put("sha", "def456");
		older.put("message", "older commit");
		ObjectNode head = commits.addObject();
		head.put("sha", "abc123");
		head.put("message", "fix: handle null payloads\n\nSigned-off-by: octocat");

		EventView view = mapper.toView(sampleEvent("PushEvent", payload));

		assertThat(view.commitMessage()).isEqualTo("fix: handle null payloads");
	}

	@Test
	void mapsPullRequestEventSummary() throws Exception {
		ObjectNode payload = objectMapper.createObjectNode();
		payload.put("action", "opened");
		payload.put("number", 42);

		EventView view = mapper.toView(sampleEvent("PullRequestEvent", payload));

		assertThat(view.summary()).isEqualTo("opened pull request #42");
		assertThat(view.action()).isEqualTo("opened");
		assertThat(view.prNumber()).isEqualTo(42);
	}

	@Test
	void mapsWatchEventSummary() {
		EventView view = mapper.toView(sampleEvent("WatchEvent", objectMapper.createObjectNode()));

		assertThat(view.summary()).isEqualTo("starred repository");
	}

	private GitHubEvent sampleEvent(String type, ObjectNode payload) {
		return new GitHubEvent(
				"1",
				type,
				new Actor(1L, "octocat", "https://avatars.example/octocat"),
				new RepoRef(2L, "octocat/Hello-World", "https://api.github.com/repos/octocat/Hello-World"),
				null,
				payload,
				true,
				"2026-06-13T12:00:00Z");
	}
}
