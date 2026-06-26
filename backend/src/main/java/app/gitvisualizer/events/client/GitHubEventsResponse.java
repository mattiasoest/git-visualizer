package app.gitvisualizer.events.client;

import java.util.List;
import java.util.Optional;

import app.gitvisualizer.events.client.model.GitHubEvent;

public record GitHubEventsResponse(
		List<GitHubEvent> events,
		Optional<String> etag,
		int pollIntervalSeconds,
		boolean notModified
) {
}
