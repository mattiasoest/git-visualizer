package app.gitvisualizer.events.support;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import app.gitvisualizer.events.client.model.Actor;
import app.gitvisualizer.events.client.model.GitHubEvent;
import app.gitvisualizer.events.client.model.RepoRef;

class EventFilterTest {

	private final EventFilter filter = new EventFilter();

	@Test
	void excludesBotActorEvents() {
		GitHubEvent githubActions = event("1", "github-actions[bot]");
		GitHubEvent dependabot = event("2", "dependabot[bot]");
		GitHubEvent renovate = event("3", "renovate[bot]");
		GitHubEvent humanEvent = event("4", "octocat");

		assertThat(filter.isIncluded(githubActions)).isFalse();
		assertThat(filter.isIncluded(dependabot)).isFalse();
		assertThat(filter.isIncluded(renovate)).isFalse();
		assertThat(filter.isIncluded(humanEvent)).isTrue();
		assertThat(filter.filterIncluded(java.util.List.of(githubActions, dependabot, renovate, humanEvent)))
				.extracting(GitHubEvent::id)
				.containsExactly("4");
	}

	@Test
	void includesEventsWithMissingActor() {
		GitHubEvent noActor = new GitHubEvent("1", "PushEvent", null, null, null, null, true, null);

		assertThat(filter.isIncluded(noActor)).isTrue();
	}

	private static GitHubEvent event(String id, String login) {
		return new GitHubEvent(
				id,
				"PushEvent",
				new Actor(1L, login, "https://avatars.example/" + login),
				new RepoRef(2L, "octocat/Hello-World", "https://api.github.com/repos/octocat/Hello-World"),
				null,
				null,
				true,
				"2026-06-13T12:00:00Z");
	}
}
