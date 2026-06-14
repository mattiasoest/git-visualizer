package app.gitvisualizer.events.support;

import java.util.List;

import org.springframework.stereotype.Component;

import app.gitvisualizer.events.client.model.GitHubEvent;

@Component
public class EventFilter {

	private static final String BOT_LOGIN_SUFFIX = "[bot]";

	public List<GitHubEvent> filterIncluded(List<GitHubEvent> events) {
		return events.stream()
				.filter(this::isIncluded)
				.toList();
	}

	public boolean isIncluded(GitHubEvent event) {
		if (event.actor() == null || event.actor().login() == null) {
			return true;
		}
		return !event.actor().login().endsWith(BOT_LOGIN_SUFFIX);
	}
}
