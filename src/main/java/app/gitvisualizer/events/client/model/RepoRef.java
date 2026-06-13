package app.gitvisualizer.events.client.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record RepoRef(
		long id,
		String name,
		String url
) {
}
