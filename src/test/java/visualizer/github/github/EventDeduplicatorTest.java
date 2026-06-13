package visualizer.github.github;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import visualizer.github.github.model.Actor;
import visualizer.github.github.model.GitHubEvent;
import visualizer.github.github.model.RepoRef;

class EventDeduplicatorTest {

	private EventDeduplicator deduplicator;

	@BeforeEach
	void setUp() {
		deduplicator = new EventDeduplicator();
	}

	@Test
	void filtersDuplicateEventIds() {
		GitHubEvent first = event("1");
		GitHubEvent duplicate = event("1");
		GitHubEvent second = event("2");

		assertThat(deduplicator.filterNew(java.util.List.of(first, duplicate, second)))
				.extracting(GitHubEvent::id)
				.containsExactly("1", "2");

		assertThat(deduplicator.filterNew(java.util.List.of(first))).isEmpty();
	}

	private GitHubEvent event(String id) {
		return new GitHubEvent(
				id,
				"PushEvent",
				new Actor(1L, "octocat", "https://avatars.example/octocat"),
				new RepoRef(2L, "octocat/Hello-World", "https://api.github.com/repos/octocat/Hello-World"),
				null,
				null,
				true,
				"2026-06-13T12:00:00Z");
	}
}
